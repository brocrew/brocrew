"""414 · the origin a model is told — each row is THE DEFECT, put back (131).

🔴 **HO-020 §5.3, the half `413` measured and did not fix.** ⚑ The PO's framing is authority and
not display:

> ⛔ **"A PM acting on words the person did not say is acting on false authority, and `214`'s 12,646
> messages say this class does not stay small."**

## ⛔ What was actually broken, measured rather than read off the sentence

| producer | what the provider received | carried its origin? |
|---|---|---|
| **`message_agent`** | **the calling model's string, verbatim** | ⛔ **nothing** |
| `deliverQuestion` · `deliverReply` · `tellOneParent` | app-composed sentences | ✔ by id |
| the composer | the person's words | ✔ — a person IS the default |

⚠️ **So it was never *"the framing loses the attribution"*. There was no framing at all**, at
exactly one producer, and that producer is how every piece of work in this product is handed over.

⛔ **And the model was not starting from nothing.** HO-015 §3 accepted *"This conversation was
spawned by parent session `sess_…`. That conversation can send you messages"*, and `factory-text.ts`
renders it at every launch and every resume. ⚑ **That says who CAN send. This says who DID** — and
`can_message: 'any'` means the sender need not be the parent at all.

## ⚑ The shape of the fix, and therefore the shape of this table

⛔ **One sentence, composed at the door, in front of the words.** `§1` is the sentence and every way
it can lie: the wrong half of the identity (`M2`), a `null` rendered as a word (`M3`), an invented
actor for a person's turn (`M5`), a spelling a model cannot match against what it was told at launch
(`M7`).

⛔ **`§2` is the four doors**, including the go-ahead — the one door that composes nothing else and
therefore had nowhere to hang a frame until this dispatch gave it one. ⚠️ **`M14` is the hazard
`handToProvider` creates by holding two session-shaped things at once**: the RECEIVING session and
the SENDING origin, one keystroke apart.

⛔ **`§5` is three rails only the compiler can enforce**, and a type is a rule with no behaviour —
so each is pinned by the clause that carries it, `HO-013 §5`: *a safety sentence with no test is a
comment*.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M23` | ⚑ **`run_suite`** — `apps/desktop/test/the-origin-a-model-is-told.test.ts` |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⚠️ One row survived its first check, and it was a NO-OP — measured, not guessed

🔴 **`M14` was originally *"invert the composition order"***: compose the task line around the
frame instead of the frame around the task line. It survived, and re-reading the two helpers says
why: ⛔ **`messageNamingItsSender` PREPENDS and `messageNamingTheTask` APPENDS, so the two nestings
produce the identical string.** `messageWithHandedPaths` appends too, so all three commute.

⚑ **There is therefore exactly ONE ordering rule in this composition and it is a DIRECTION, not a
nesting** — *the frame goes in front* — and `M1` is the row that prices it. A row on the nesting
would have been `a-mutation-that-changes-nothing-reports-as-a-survivor`, and the survivor is the
only way that shows. ⚠️ **`M14` is now the hazard that is real at that line**: two session-shaped
values in one scope.

## ⛔ What this table deliberately does NOT contain

🔴 **No row coupling the origin to `workBeingAssigned`.** It is the tempting implementation — that
method already computes both facts, for the `task_assigned` row — and **a row pricing it would
survive**, because today every agent-to-agent message mints a task, so *"is this work"* and *"is the
caller an agent"* cannot disagree. ⚑ `a-rule-measured-only-where-both-readings-agree`: three of
`341`'s rows survived exactly this way. The coupling is refused in the code and named in a comment
instead, because `412` F1's KIND is with the PO and would make the two readings diverge for the
first time.

⛔ **No row making the line print `agent_identity.display_name` or `role`.** Neither is reachable
from `SessionStore.identityOf`, which returns three fields and no name — so there is no
single-token mutation that could. ⚠️ **The suite's planted control is a control and not a row**: it
writes a display name and a role onto both identity tables and asserts neither reaches the model,
which guards the change somebody would make tomorrow rather than a line that exists today.

⛔ **No row on `412`'s finishing line, its position or its id.** `412` shipped no mutation table at
all, and adopting its rules here would spell them in a dispatch that did not make them. `M14` prices
the ORDER, which is this dispatch's, and touches `412`'s gate only as a second killer.

⛔ **No row on the rails.** `queueMessage` asks `374`'s `assertMayReach` before any of this, and
`413`'s own table owns every reading of `whoseWordsTheseAre`.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-011 names the sender (by its display name) and where it stands, and moved the id into the direction
line: M2, M3, M7, M13 and M14 were corrected in place; M2, M7, M13 and M14 are now also killed by
`the-sender-says-where-it-stands.test.ts`, and M3 by the origin test's no-binding case. M18 was
re-aimed at D-011's WHAT clause (`handsYouThisWork`). ⚠️ M7 now guards the id's backticks in the BOUND
arm's direction line; the no-binding arm's backticked id has no row. M16's label quotes the retired
sentence (*running as profile*); its defect is unchanged. The docstring's display-name note and *no row
coupling the origin to `workBeingAssigned`* are superseded by D-010 and D-011.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"

MUTATIONS = [
    # ── §1 · the sentence ─────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the frame becomes a FOOTNOTE · the sender is named after the words instead of in "
        "front of them, so a model reads the turn as its own reader's and is corrected at the end "
        "— which is `214`'s defect with an apology attached",
        [
            (
                ORIGIN,
                "  return text.trim() === '' ? line : `${line}\\n\\n${text}`",
                "  return text.trim() === '' ? line : `${text}\\n\\n${line}`",
            )
        ],
    ),
    (
        "M2 · ⛔ the CONVERSATION is dropped and only the identity is named · the one string a "
        "model can match against *spawned by parent session `sess_…`* disappears, so the frame "
        "stops being checkable against what the launch layer told it",
                # ⚑ **T-003 · re-anchored in place, not retired** — D-011 moved the id into the direction line (*You are answering X, conversation `sess_…`*); the row drops it there, so only the identity is named. Re-verified RED alone.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives for a sender that holds no piece: commit c1a79abe
        # leaves an id only as the address of a conversation that holds no piece, and that branch
        # still renders 'name (profile), conversation `sess_…`' in the direction line. The plant
        # drops the id there, so the model can no longer match the address it was told. Killed by
        # `the-origin-a-model-is-told.test.ts`, `a-question-names-who-it-is-for.test.ts`.
        [
            (ORIGIN, '      : who === `\\`${from.caller}\\``\n        ? who\n        : `${who}, conversation \\`${from.caller}\\``\n', '      : who\n'),
        ],
    ),
    (
        "M3 · ⛔ a conversation with no binding is named `null` · 074's third state rendered as a "
        "word, in a sentence whose whole job is to be true — *running as profile `null`* reads as "
        "an identity rather than as its absence · killed by `the-origin-a-model-is-told.test.ts` (named by W4.78)",
        [
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 439** — the binding is `said` now, because `439`
            # appends a second sentence to it and `line` became the name of the pair. ⛔ The defect
            # is unchanged: the two-branch ternary collapses and a conversation with no binding is
            # named `null` in a sentence whose whole job is to be true.
            (
                ORIGIN,
                # ⚑ **T-003 · re-anchored in place, not retired** — D-011 names a sender by its name and profile; the row still renders the no-binding arm as if it had one. Re-verified RED alone.
                # ⚑ **W4.78 · re-anchored in place, not retired** — D-011 (79245533) moved the two-arm naming out of messageNamingItsSender into theAgentNamed(); the plant collapses it there, so a sender with no binding is named `null (null)`. Killer: the origin test's 'no binding … never the word null' case (§3).
                "  return from.profile === null || stands.name === null\n    ? `\\`${from.caller}\\``\n    : `${stands.name} (${from.profile})`",
                "  return `${stands.name} (${from.profile})`",
            )
        ],
    ),
    (
        "M4 · ⛔ a blank message ends in an empty paragraph · the shape `messageNamingTheTask` "
        "already settled, on a PREPEND rather than an append: `\\n\\n` behind nothing is a turn "
        "whose last two lines are blank, and the model is left reading for words that never come",
        [
            (
                ORIGIN,
                "  return text.trim() === '' ? line : `${line}\\n\\n${text}`",
                "  return `${line}\\n\\n${text}`",
            )
        ],
    ),
    (
        "M5 · 🔴 the app INVENTS AN ACTOR for a person's own turn · `413` §4's *no invented actor* "
        "broken from the other side: a typed message reaches the provider with a sentence the "
        "person did not write, describing them · killed by `the-origin-a-model-is-told.test.ts` (named by W4.78)",
        [
            (
                ORIGIN,
                # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 turned `if (from === null) return text` into a block that adds a stop line when an interrupt was asked. Since 607 `null` is the APP's own words (the person's arm carries A_PERSON_SENT_IT by design), so the plant now credits a person with words they never wrote — 413 §3's invented actor; the label's 'a person's own turn' wording predates 607. Killer: origin test §3 '`null` is THE APP' (toBe('just my words')).
                "    return interrupting === undefined\n      ? text\n",
                "    return interrupting === undefined\n      ? `Sent by the person at the keyboard.\\n\\n${text}`\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ the frame stops being its own paragraph · one newline instead of two, so the "
        "attribution reads as the first line OF the message rather than as a line about it — and "
        "a model scanning for where somebody's words begin has nothing to scan for",
        [
            (
                ORIGIN,
                "  return text.trim() === '' ? line : `${line}\\n\\n${text}`",
                "  return text.trim() === '' ? line : `${line}\\n${text}`",
            )
        ],
    ),
    (
        "M7 · ⛔ the id loses its backticks · the launch layer spells it `` `sess_…` `` and this "
        "would spell it bare, so the two sentences a model has to reconcile are no longer one "
        "string — `a-negative-is-only-as-strong-as-the-search-shape`, from the model's side",
        [
            (
                ORIGIN,
                # ⚑ **T-003 · re-anchored in place, not retired** — D-011 spells the id, backticked, in the direction line; the row drops its backticks there. Re-verified RED alone.
                "`${who}, conversation \\`${from.caller}\\``",
                "`${who}, conversation ${from.caller}`",
            )
        ],
    ),
    # ── §2 · the four doors ───────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 the SENT door stops asking · the shipped defect, put back at the place `410` F2 "
        "counted it: a task one agent gives another reaches the other's model as bare words · killed by `the-origin-a-model-is-told.test.ts` (named by W4.139)",
                # ⚑ **Anchor corrected by `662`**: the call is no longer nested in `handle.send`,
                # so its arguments sit one level shallower. The door and the rule are unchanged.
                # ⚑ **Corrected again by `670`**: the call sits in a `try` now, one level DEEPER.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. sendAs passes the piece being handed AND the asker's origin to handToProvider, so
        # the receiver is told both who gave it the piece and what the piece is. The plant keeps the
        # piece and drops the origin (null), so the receiver reads the piece as coming from nobody.
        # Killed by `the-sender-says-where-it-stands.test.ts`, `the-origin-a-model-is-told.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a queued send must hand the provider the caller's origin so the model is told
        # who is speaking. sendAs still ends with handToProvider(..., handing, this.originOf(by))
        # and the old anchor moved with the new handing argument. The plant hands null as the
        # origin. Killed by `the-origin-a-model-is-told.test.ts`,
        # `the-sender-says-where-it-stands.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033 gave handToProvider the piece the words drive, between the piece they carry and who sent them
            # ⚑ **W4.147 · re-anchored in place, not retired** — F088 gave handToProvider the piece an agent's note or follow-up names, after the piece the words drive, and prettier put the call on one argument per line; same rule, same plant: the queued send still hands null as the origin
            # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The queued send now also hands handToProvider its turn row, for whose turn it is; the same plant still hands null as the origin. No plant or table run.
            (HOST, "        handing,\n        drives,\n        about,\n        this.originOf(by),\n        turn,\n      )", "        handing,\n        drives,\n        about,\n        null,\n        turn,\n      )"),
        ],
    ),
    (
        "M9 · ⛔ the INTERRUPTING door stops asking · nothing reaches it as anything but a window "
        "today, so this row is caught by the source census rather than by a sample — which is the "
        "point: *right by accident* is what a shared derivation exists to stop being the reason · killed by `the-origin-a-model-is-told.test.ts` (named by W4.139)",
        [
            (
                HOST,
                # ⚑ **Anchor corrected by `662`** — the door calls `handToProvider` bare now.
                # ⚠️ Since `662` the null also drops the STAMP, so a sample catches this row too
                # (`whose-words-the-provider-is-told.test.ts`, the interrupting door as an agent);
                # the label's *"caught by the source census rather than by a sample"* is `414`'s.
                # ⚑ **713 · corrected in place** (standing rule 27): the interrupting handover hands over
                # its first gate's answer (`decided`, `708` H-4), so the call gained an argument. Same
                # rule, same replacement; re-verified RED alone, killer named in 713's response.
                # ⚑ **W4.136 · re-anchored in place, not retired** — F033 gave handToProvider the piece the words drive (null here), so the origin is one argument later
                # ⚑ **W4.147 · re-anchored in place, not retired** — F088 gave handToProvider the piece an agent's note or follow-up names, after the piece the words drive, and prettier put the call on one argument per line; same rule, same plant (null here): the interrupting door still hands null as the origin
                # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The interrupting handover now also hands over its turn row; the same plant still hands null as the origin. No plant or table run.
                "        null,\n        null,\n        null,\n        this.originOf(by),\n        turn,\n        decided,\n      )",
                "        null,\n        null,\n        null,\n        null,\n        turn,\n        decided,\n      )",
            )
        ],
    ),
    (
        "M10 · 🔴 the GO-AHEAD grows a frame · `GO_AHEAD_MESSAGE` is a renderer constant and the "
        "same method records that turn `app_authored` unconditionally, so a line reading *Sent by "
        "`sess_…`* attributes BroBot's own sentence to whoever pressed the button. ⚠️ `414` wrote "
        "exactly this and the by-hand pass took it out",
        [
            (
                HOST,
                # ⚑ **Anchor corrected by `662`**: the go-ahead now passes its stamp, which is
                # `null` for the frame's reason. The row still grows the frame and nothing else.
                "      await session.handle.send(text, this.stampFor(null, []))",
                "      await session.handle.send(\n"
                "        messageNamingItsSender(text, this.originOf(by)),\n"
                "        this.stampFor(null, []),\n"
                "      )",
            )
        ],
    ),
    (
        "M11 · 🔴 the held message does not carry it · a child that happened to be BUSY is handed "
        "unframed words and an idle one is not — `406`'s report defect and `412`'s task defect "
        "arriving a third time, in the shape that looks like model flakiness",
        # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
        [(HOST, "      // ⚑ **414** — see {@link QueuedMessage.origin}: the flush has no `by` to derive from.\n      ...(from === null ? {} : { origin: from }),\n", "      // ⚑ **414** — see {@link QueuedMessage.origin}: the flush has no `by` to derive from.\n")],
    ),
    (
        "M12 · ⛔ the FLUSH stops reading it · the other half of `M11`: the mailbox holds the "
        "origin and the composition throws it away, so the fact is recorded and never used",
        # ⚑ **Anchor corrected by `662`** — the flush's arguments lost a level with the handover.
        [(HOST, "          queued.origin ?? null,", "          null,")],
    ),
    (
        "M13 · ⛔ the composition drops the frame entirely · `handToProvider` takes the origin and "
        "composes without it, which is the defect that survives every door-level census · killed by `the-origin-a-model-is-told.test.ts` (named by W4.78)",
                # ⚑ **T-003 · re-anchored in place, not retired** — D-011 gave `messageNamingItsSender` a standing callback; the row still composes without the frame. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. handToProvider must name the sender to the provider through messageNamingItsSender,
        # with whereTheSenderStands saying what the sender hands and what open work it gave. The
        # call is still in handToProvider. The plant sends the bare message, so the model is not
        # told who is speaking. Killed by `the-origin-a-model-is-told.test.ts`,
        # `the-sender-says-where-it-stands.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 added the `interrupting` argument and prettier reflowed the call over lines; the plant still composes without the sender frame. Killer: 'names WHO sent it and the TASK it hands over' (table 414's header names this file).
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: where the sender stands is also told the piece the words drive, to name the sender by it
            # ⚑ **W4.147 · re-anchored in place, not retired** — F088: where the sender stands is also told the piece the words name, to say which piece the message is about; the plant still composes without the sender frame
            # ⚑ Re-anchored in place, not retired — a request a person moved here now carries a line saying so in front of their words, inside the frame; the plant still composes without the sender frame.
            (HOST, "      messageNamingItsSender(\n        messageWithHandedPaths(this.withWhereItWasMovedFrom(text, authorship.movedFrom), handed),\n        from,\n        (sender) => this.whereTheSenderStands(sender, session.id, handing, drives, about),\n        interrupting,\n      ),\n", "      messageWithHandedPaths(this.withWhereItWasMovedFrom(text, authorship.movedFrom), handed),\n"),
        ],
    ),
    (
        "M14 · 🔴 the two session-shaped things in scope are SWAPPED · `handToProvider` holds the "
        "RECEIVING session and the SENDING origin at once, and the frame is built from the wrong "
        "one — so every turn tells a model it was sent by itself, which is `413` `M7`'s defect "
        "arriving at the provider instead of at the transcript · killed by `the-origin-a-model-is-told.test.ts` (named by W4.78)",
        [
            (
                HOST,
                # ⚑ **T-003 · re-anchored in place, not retired** — D-011 split the call over lines; the row still builds the frame from the RECEIVING session. Re-verified RED alone.
                # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 reflowed messageNamingItsSender over lines (new `interrupting` argument); the plant still builds the frame from the RECEIVING session instead of `from`. ACallerWithAnId still has who/caller/profile/aPersonIsBehindIt. Killer: the sender-line assertions (e.g. 'names WHO sent it', 'a person's typed turn says a person sent it').
                # ⚑ Re-anchored in place, not retired — the words framed now carry a moved request's line in front; the plant still builds the frame from the RECEIVING session.
                "        messageWithHandedPaths(this.withWhereItWasMovedFrom(text, authorship.movedFrom), handed),\n        from,\n",
                "        messageWithHandedPaths(this.withWhereItWasMovedFrom(text, authorship.movedFrom), handed),\n        {\n          who: 'a-caller-with-an-id',\n          caller: session.id,\n          profile: session.profileId,\n          aPersonIsBehindIt: false,\n        },\n",
            )
        ],
    ),
    # ── §3 · who is asking ────────────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 the derivation goes back to *an agent, otherwise nobody* · the two POSITIVE "
        "tests collapse into one negative, so a person's typed turn is still bare BY ACCIDENT and "
        "the caller `413` predicted — the MCP transport `THE_APP_ITSELF`'s docblock names — reaches "
        "a model with no frame at all, read as the person's",
        [
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 439** — the third-branch literal grew a field
            # (`aPersonIsBehindIt`), so the line it ends on moved. ⛔ The defect is unchanged: the
            # two POSITIVE tests collapse into one negative and a person's turn is bare by accident.
            #
            # ⚑ **AND AGAIN BY 607**, which split the person's `null` into a value of its own and
            # put a comment between the two guards — so the three-line anchor could no longer match
            # and the row would have gone dark. ⛔ **Corrected, never retired**: the defect is still
            # exactly *an agent, otherwise nobody*, and 607 made it WORSE rather than obsolete —
            # under this mutant the person's own line disappears as well as the transport's frame.
            (HOST, "    if (by === THE_APP_ITSELF) return null\n", ""),
            (HOST, "    if (aPersonTypedIt(by)) return THE_PERSON_AT_A_WINDOW\n", ""),
            (
                HOST,
                "    if (conversation === null)\n"
                "      return {\n"
                "        who: 'a-caller-with-an-id',\n"
                "        caller: by.ownerId,\n"
                "        profile: null,\n"
                "        aPersonIsBehindIt: false,\n"
                "      }",
                "    if (conversation === null) return null",
            )
        ],
    ),
    (
        "M16 · ⛔ the identity is the conversation · the frame reads *running as profile "
        "`sess_…`*, so the two halves say one thing twice and the ledger's own answer for WHO is "
        "never asked",
        [
            (
                HOST,
                "      profile: this.deps.store.identityOf(conversation)?.profileSlug ?? null,",
                "      profile: conversation,",
            )
        ],
    ),
    (
        "M17 · 🔴 the ROW loses the identity the LINE keeps · `task_assigned.assignedByProfile` "
        "goes null while the provider is told the slug, so a board row and the words a model reads "
        "disagree about who gave the work — 149's shape, which one derivation exists to prevent",
        # The board row and sender frame must name the same giver. recordTheGive writes
        # work_given.givenBy from piece.giver; plant the receiver’s session.id instead. A valid ID
        # keeps the row well-formed, so failure measures the disagreement rather than a skipped torn
        # row. Target only the ledger event, leaving the store work row and frame correct.
        [
            (HOST, '      label: piece.label,\n      parent: piece.parent,\n      givenBy: piece.giver,\n      title: piece.title,\n', '      label: piece.label,\n      parent: piece.parent,\n      givenBy: session.id,\n      title: piece.title,\n'),
        ],
    ),
    (
        "M24 · ⛔ the APP's own sentences grow a frame · a reply, a routed question and a stall "
        "notice are BroBot's words ABOUT a conversation, and each already names it — a frame in "
        "front would be BroBot introducing itself to a parent that never heard from anyone else",
        # ⚠️ A REPLACEMENT and not a deletion: removing the branch leaves `by.ownerId` on a
        # `Caller` that TypeScript has not narrowed, so the mutant would not compile and its red
        # would come from a text census rather than from the product — a red that proves nothing.
        #
        # ⛔ **607 · and by that argument the replacement itself had gone stale, twice.** `439` gave
        # `TurnOrigin` an `aPersonIsBehindIt` and `607` gave it a `who`, and neither was added here
        # — so this literal had stopped being a value the type admits, which is the very thing the
        # paragraph above rules out. ⚑ **The defect is unchanged**; what changed is that the mutant
        # is again code somebody could have written.
        [
            (
                HOST,
                "    if (by === THE_APP_ITSELF) return null",
                "    if (by === THE_APP_ITSELF)\n"
                "      return {\n"
                "        who: 'a-caller-with-an-id',\n"
                "        caller: 'BroBot',\n"
                "        profile: null,\n"
                "        aPersonIsBehindIt: false,\n"
                "      }",
            )
        ],
    ),
    # ── ⛔ RETIRED BY 607, and it is a REVERSAL rather than a rename ─────────────────────────
    #
    # 🔴 **This row's defect became the product.** `HO-088` §4 ruled *"Every message an agent
    # receives says who sent it: the person, or a named agent"*, and `607` built the person half —
    # so a window's turn now DOES carry a sentence in front of it, deliberately, rendered from the
    # same positive test this row was written to protect.
    #
    # ⛔ **The definition stays (142: nothing is deleted) and the row is acknowledged by name**, so
    # the census reports the retirement rather than going quiet about it (`HO-050` §3).
    #
    # ⚠️ **Its `214` citation was the half that did not survive the check, and it is worth writing
    # down.** `214`'s defect is a LEDGER defect — *"the transcript would render BroBot's sentence
    # as something they typed"* — and `send`'s own docblock says the two strings differ on purpose:
    # *"The provider gets `messageWithHandedPaths(text, paths)`… The LEDGER gets `{ text,
    # attachments }`, with the person's words alone in `text`."* ⛔ **`607` changed the first and
    # not the second**, and `the-origin-a-model-is-told.test.ts` §1 asserts both in one test. ⚑ So
    # this row was never guarding `214`; it was guarding a decision `414`'s brief instructed and a
    # PO ruling has since reversed.
    (
        "M25 · 🔴 RETIRED BY 607 (reversed, not renamed) · a WINDOW's turn grows a frame · the "
        "person's own typed words reach their agent with a sentence they did not write in front of "
        "them. ⛔ `HO-088` §4 ruled that sentence REQUIRED and `607` renders it; the `214` citation "
        "was wrong on its own terms, because `214` is about the LEDGER and the ledger still holds "
        "the person's bare words",
        [(HOST, "    if (aWindowIsAsking(by.ownerId)) return null\n", "")],
    ),
    # ── §4 · what it must not say ─────────────────────────────────────────────────────────────
    (
        # ⚑ **T-003 · re-anchored in place, not retired** (T-003's review) — D-011, not D-010, moved
        # it: the sender line now says WHAT only when these words hand over work
        # (`handsYouThisWork`). Calling every agent message work — a note or a follow-up included —
        # is still the defect, so the row now plants it there; killed by
        # `the-sender-says-where-it-stands.test.ts` (a peer's note reads *it gave you no work*).
        # Re-verified RED alone.
        "M18 · ⛔ the sentence says WHAT as well as WHO · it classifies the message as work, which "
        "is the ruling `412` F1 put in front of the PO — a KIND telling work from a question about "
        "an existing task. ⚠️ Baking it in here would make the app answer a question nobody has",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. whereTheSenderStands must report handsYou only when the sender is handing a piece,
        # and null otherwise, so a plain note is not framed as a give. The plant always reports a
        # piece, inventing 'W1' and a null title when nothing is handed. Plausible rather than
        # certain: the exact label wording was checked against today's code, not against the label's
        # original test. Killed by `the-sender-says-where-it-stands.test.ts`,
        # `the-origin-a-model-is-told.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the sender line states a piece it hands you only when it hands one.
        # whereTheSenderStands now builds handsYou from handing with an as: 'given' or 'rebriefed'
        # field. The plant always claims a handed piece, with a made-up label when there is none.
        # Killed by `the-sender-says-where-it-stands.test.ts`, `the-origin-a-model-is-told.test.ts`.
        [
            (HOST, '      handsYou:\n        handing === null ? null : { label: handing.label, title: handing.title, as: handing.as },', "      handsYou: { label: handing?.label ?? 'W1', title: handing?.title ?? null, as: handing?.as ?? 'given' },"),
        ],
    ),
    # ── §5 · the rails only the compiler can enforce ──────────────────────────────────────────
    (
        "M19 · ⛔ `queueMessage` starts ACCEPTING a task id · it mints one, from "
        "`workBeingAssigned`, and a caller allowed to name one could make any message claim to "
        "hand over work that nothing recorded. ⚠️ The row deletes the `never` and keeps the "
        "`Omit`, which is the state 414 shipped first: excess-property checking fires on a fresh "
        "object literal and NOT on a variable, so a caller holding a `TurnFacts` could pass it "
        "whole and `{ ...facts }` would carry the smuggled id into `send`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. queueMessage's facts type forbids `giving`, so a give can only go through sendAs
        # and never be queued by the wrong door. The plant widens the type back to
        # Omit<TurnFacts,'giving'> only, which is the 'a type permits it' hole. Vitest does not
        # type-check, so this row can only go red if a test reads the type text. Killed by
        # `the-origin-a-model-is-told.test.ts`, `taking-work-back.test.ts`,
        # `a-task-you-can-see.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a queued message may not carry a giving, and the FactsAQueueCarries type is
        # the rail that keeps it out. The type now omits both giving and rebriefing and adds
        # giving?: never. The plant drops the never line. This is a text-census kill, since vitest
        # does not type-check. Killed by `the-origin-a-model-is-told.test.ts`,
        # `taking-work-back.test.ts`, `a-task-you-can-see.test.ts`.
        [
            (HOST, "type FactsAQueueCarries = Omit<TurnFacts, 'giving' | 'rebriefing'> & {\n  readonly giving?: never\n", "type FactsAQueueCarries = Omit<TurnFacts, 'giving' | 'rebriefing'> & {\n"),
        ],
    ),
    (
        "M20 · ⛔ authorship starts accepting the task id · a signature that took one could be "
        "read as though a task might decide whose words a turn is, which is the confusion the "
        "`Pick` exists to make unspellable",
        [
            (
                HOST,
                # ⚑ **RE-POINTED at 624, not retired** — `appNotice` joined the `Pick` as a third
                # SUBJECT (`HO-095` §6.1). ⛔ The row's subject is unchanged and its defect is the
                # same one: the signature starts accepting `taskToQuote`, so a task id could be
                # read as deciding whose words a turn is.
                # `correct-a-stale-mutation-anchor-dont-retire-it`.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 added answered-question authorship context; the signature still intentionally excludes task/giving fields.
                "  facts: Pick<TurnFacts, 'report' | 'carriedFor' | 'appNotice' | 'answeredQuestion'> = {},",
                "  facts: TurnFacts = {},",
            )
        ],
    ),
    (
        "M21 · ⛔ the origin gains a default a door can forget · `412`'s ruling for the task, "
        "inverted: *this turn came from nobody* becomes the thing a fifth send path gets by "
        "omission, and the symptom is a turn that reads as the person's. ⚠️ A DEFAULT and not an "
        "`?`, because `from?:` widens the type to `| undefined` and the mutant does not compile — "
        "a row whose red comes only from a text census is a red that proves nothing",
        [(HOST, "    from: TurnOrigin | null,", "    from: TurnOrigin | null = null,")],
    ),
    # ── §6 · the two strings that leave one method ────────────────────────────────────────────
    (
        "M22 · 🔴 the LEDGER stores the framed string · `216`'s rule broken from the other end: "
        "BroBot's own sentence is recorded as something the sender typed, permanently, with "
        "nothing in the transcript to tell the two apart — which is `214` arriving by the door "
        "this dispatch opened",
        [
            (
                HOST,
                "      type: 'user_turn',\n"
                "      text,\n"
                "      // Spread rather than assigned, so an ordinary turn carries no such key at all",
                "      type: 'user_turn',\n"
                "      text: messageNamingItsSender(text, this.originOf(by)),\n"
                "      // Spread rather than assigned, so an ordinary turn carries no such key at all",
            )
        ],
    ),
    # ── §7 · the distinction `carriedFor` marks ───────────────────────────────────────────────
    (
        "M23 · ⛔ the two conversation facts are run together · a routed question — BroBot's own "
        "sentence ABOUT a child — is framed as *sent by* that child, which is false and is exactly "
        "the reading `413`'s `relayedFrom` invites · killed by `the-origin-a-model-is-told.test.ts` (named by W4.139)",
                # ⚑ **Anchor corrected by `662`**, one level shallower like `M8`'s. Same mutation.
                # ⚑ **Corrected again by `670`**, one level deeper like `M8`'s. Same mutation.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. sendAs takes the asker's origin from originOf(by) and nothing else, so a
        # caller-carried message is not given an origin invented from `carriedFor`. The plant
        # invents a caller origin when originOf is null, so a message a person sent on a caller's
        # behalf is labelled as that caller's. Plausible rather than certain. Killed by
        # `the-origin-a-model-is-told.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a routed question's answer carries the caller's origin, falling back to the
        # carried-for id caller. It shares its anchor with M8, so apply each alone. The plant keeps
        # originOf(by) and adds a fallback origin built from facts.carriedFor. Killed by
        # `the-origin-a-model-is-told.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033 gave handToProvider the piece the words drive, between the piece they carry and who sent them
            # ⚑ **W4.147 · re-anchored in place, not retired** — F088 gave handToProvider the piece an agent's note or follow-up names, after the piece the words drive, and prettier put the call on one argument per line; same rule, same plant: the plant still adds an origin invented from carriedFor (it shares its anchor with M8; apply each alone)
            # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The queued send now also hands handToProvider its turn row; the same plant still adds an origin invented from carriedFor (it shares its anchor with M8; apply each alone). No plant or table run.
            (HOST, "        handing,\n        drives,\n        about,\n        this.originOf(by),\n        turn,\n      )", "        handing,\n        drives,\n        about,\n        this.originOf(by) ??\n          (facts.carriedFor === undefined\n            ? null\n            : { who: 'a-caller-with-an-id' as const, caller: facts.carriedFor, profile: null, aPersonIsBehindIt: false }),\n        turn,\n      )"),
        ],
    ),
]
