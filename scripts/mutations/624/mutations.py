"""624 · A message says who wrote it, and a report says what is true.

⛔ **Ordered by `HO-095` §6 (whole), §5.2 and §5.3.** ⚑ **One defect wearing four coats**, and the
PO named the class: *a record may not assert something nobody did* — criterion 18, invoked in
three documents running.

## 🔴 What shipped, measured on the first clean-install run

⚠️ **`615` built the approval carrier and it reached BroBot's conversation with no SUBJECT.**
⚑ `whoseWordsTheseAre` had already marked the turn `app_authored`; what decides the ENTRY is the
subject beside it, and `transcript.ts`' own note priced the no-subject fallback as sound *"for
every ledger ever written"* — true until `615` wrote the fourth producer. So the row read **You**,
offered **Cancel it** on a project that already existed, and once delivered carried the plan
go-ahead's caption about a button nobody pressed.

⛔ **And the same shape reaches a WORKER**: `591`'s delivery of a question answered by a PERSON
passes no `carriedFor`, so an answer arrived in the worker's own transcript under the reader's
name too. ⚑ That is the sweep `HO-095` §6.3 asked for, found rather than assumed.

## The row groups

 * `M1`-`M3`   🔴 **the subject** — the decision loses it, the answer loses it, and the HELD row
                stops carrying it while the turn it becomes still does.
 * `M4`        🔴 **the fold** — every notice lands back on the go-ahead's entry.
 * `M5`-`M6`   ⛔ **the cancel** — the control comes back on the row, and the RAIL behind it goes.
 * `M7`-`M8`   ⚠️ **what the row says** — it signs itself *You* again, and it inherits the
                go-ahead's caption.
 * `M9`-`M11`  ⛔ **the stall report** — the false clause comes back, the name becomes a handle,
                and the ids come back into the description.
 * `M12`       ⚠️ **the carrier's own sentence** — the proposal id returns to a person's line.
 * `M13`       ⛔ **an EXPECTED SURVIVOR**, and it is a statement about the harness — see below.

## ⛔ `M13` is expected to survive, and that is deliberate

⚑ The row removes `appNotice === undefined` from {@link whoseWordsTheseAre}'s first conjunction —
the BELT that stops a window's turn swallowing a notice-bearing fact. ⚠️ **No caller passes a
notice from a window**, exactly as none passes a `report` from one, so nothing in four vitest
projects can reach the branch. ⛔ Recorded as an expected survivor rather than dropped, because a
table that only carries rows it can kill has stopped measuring its own edges — `278 M12`'s shape,
one dispatch's reasoning over.

## ⚠️ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row reaches the run.** `HO-095` is a photograph of a clean install; every row here is
   killed by a unit or SSR assertion, and what that proves is what the app COMPOSES and DRAWS, not
   what the person saw. ⚑ The end-to-end half is `a-message-says-who-wrote-it.test.ts` §1, which drives
   a real proposal through a real host and reads the parent's own ledger.
 * ⚠️ **No row mutates the vocabulary's SENTENCES.** `NOTICE_MEANS` is copy; a row over it could
   only be killed by a source census, and `268 §1` ruled that a RED produced only by a text census
   is non-evidentiary. ⛔ What IS killable is the caption being the WRONG one, which is `M8`.
 * ⚠️ **No row reaches the composer's own Cancel.** `RuntimeScreen.cancelQueued` names the HEAD of
   the mailbox whatever kind it is; `M6` kills the rail that now refuses it, which is the half
   this dispatch owns.

## ⚑ WRITTEN, not run

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** No
`mutations.txt` exists at this HEAD and its absence is the honest state.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
PROPOSALS = "apps/desktop/src/main/runtime/proposal-rails.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
QUEUED = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
ENTRY = "apps/desktop/src/renderer/src/components/AppNoticeEntry.vue"

# ⚑ ANCHOR CORRECTED IN PLACE BY 687: `heldAuthorship` is gone (R22) and the held row spreads the entry's authorship
# whole, so `M3`'s planting — the subject dropped on the way to the held row — moves to that spread.
HELD_ROW = "      ...held.authorship,\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the subject ───────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The decision carrier that passed `{
        # appNotice: 'a-decision-a-person-made' }` is deleted, and that word was removed from
        # APP_NOTICES (bd70d693 app-notice.ts diff; old ledgers now read the generic
        # `A_NOTICE_MEANS`). The 'no subject on the carrier' rule survives on the remaining producer
        # and is already carried by 624 M2 (deliverAnswer's `an-answer-to-a-question` arm). Its
        # anchor is left stale, so the census records it retired.
        "M1 · 🔴 **THE DEFECT · the decision carrier passes no subject** · `whoseWordsTheseAre` "
        "then produces `{ attribution: 'app_authored' }` alone, which is exactly what shipped: "
        "the held row reads *You* with **Cancel it** under it, and the delivered turn inherits the "
        "plan go-ahead's caption. ⛔ `HO-095` §6.1, §6.2 and §6.3 are all one missing argument",
        [(HOST, "        { appNotice: 'a-decision-a-person-made' },\n", "")],
    ),
    (
        "M2 · 🔴 **the same defect on the WORKER's transcript** · a question answered by a PERSON "
        "has no conversation to attribute to, so the arm reverts to `{}` and `591`'s delivery "
        "lands under the reader's name. ⚑ This is the surface the sweep found rather than the one "
        "the photograph showed, and it is the reason the repair is a SUBJECT and not a special "
        "case in the proposal path",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The exact ternary
        # (`answeredBy === null ? { appNotice: 'an-answer-to-a-question' as const } : { carriedFor:
        # answeredBy }`) is unchanged in substance in runtime-host.ts's deliverAnswer path; the
        # count_now=0 was a pure whitespace/line-wrap mismatch in the row's anchor (the file wraps
        # the ternary across 3 lines with 6/8-space indents, not the row's original spacing). The
        # defect — a person's answer losing its app-attribution and reverting to `{}` — is still
        # fully plantable.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 added answered-question facts; retain those and omit only app authorship when a person answered.
            (HOST, "      answeredBy === null\n        ? { appNotice: 'an-answer-to-a-question' as const, answeredQuestion }\n        : { carriedFor: answeredBy, answeredQuestion }", "      answeredBy === null\n        ? { answeredQuestion }\n        : { carriedFor: answeredBy, answeredQuestion }"),
        ],
    ),
    (
        "M3 · ⛔ **the HELD row stops carrying the subject** · `heldAuthorship` keeps the "
        "authorship and drops everything else, so the turn is right and the row a person reads "
        "FIRST is wrong — and a proposal is decided while the proposer is working at least as "
        "often as not, which makes the held row the ordinary case rather than the edge. ⚠️ The "
        "`Omit` is what carried this key without anybody editing the function; inverting it is "
        "what a reader who trusted the docblock would never look at",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — This commit's new
        # `holdForTheNextStart` method (D-017 R1) introduced a second, byte-identical
        # `...held.authorship,` spread (line ~8110) beside the pre-existing one in `queueAs` (line
        # ~15886, the one 624:M3 and 657:M9 actually protect — 'a proposal is decided while the
        # proposer is working'), which is why the bare anchor now matches twice instead of once. The
        # rule itself is untouched and is even restated verbatim in a comment right above the
        # surviving occurrence ('the held row carries the authorship WHOLE'). Anchored with the
        # preceding comment block to disambiguate to the `queueAs` occurrence.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the held queue row must carry the entry's own authorship, including the
        # app-notice subject, because the transcript says who wrote a held message. In the piece
        # model the row is still built with `...held.authorship` in `queueAs`. The plant spreads
        # that authorship without its `appNotice` field. Killed by
        # `a-message-says-who-wrote-it.test.ts`.
        [
            (HOST, "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...held.authorship,", "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...(({ appNotice: _subject, ...subject }) => subject)(held.authorship),"),
        ],
    ),
    # ── B · the fold ──────────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 **the fold ignores the subject** · the wire says the app wrote it and the "
        "transcript routes it to {@link ContinuationItem} anyway — the half a wire-only fix "
        "leaves behind, and the one that puts *BroBot sent this when you pressed 'Start work on "
        "this plan'* under a proposal somebody approved",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The fold still routes a
        # notice-bearing user turn to its own `appNotice` entry by subject; D-016 only changed the
        # guard from `isAppNotice(...)` to `carriesANotice(...)` (a non-empty string, so retired
        # words still draw). Removing that branch lets an app-authored notice fall to
        # `appendAppTurn` and read as the plan go-ahead's `continuation`, which is the label's
        # defect.
        [
            (FOLD, '      else if (carriesANotice(event.appNotice)) appendAppNotice(state, event.text, event.appNotice)\n', ''),
        ],
    ),
    # ── C · the cancel ────────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ **Cancel it comes back on the app's delivery** · the row offers to take back the "
        "only copy of a fact that reaches the model, which would leave BroBot never learning it "
        "was approved — **the exact defect `615` built this carrier to close** (`609`: *the bound "
        "fires, the person answers an hour later, the project is created — and the agent that asked "
        "for it is never told it exists*)",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the go-ahead joined `theirs` after the notice (R22); the row — the
        # notice regaining Cancel it — is unchanged.
        [(QUEUED, "    props.item.appNotice !== undefined ||\n", "    false ||\n")],
    ),
    (
        "M6 · 🔴 **the RAIL goes and only the hidden button is left** · "
        "`a-conditional-override-is-not-a-bound`, and `HO-095` §6.2 asked for the capability to "
        "be expressed where it lives. ⚠️ The composer's own Cancel names the HEAD of the mailbox "
        "whatever kind it is, so with this gone a person with a notice at the head takes it back "
        "from a row that was never drawn for it — and the stall notice goes with it, whose cancel "
        "withdraws `404`'s receipt and leaves the next launch inheriting a claim that the parent "
        "was told something it never heard",
        [
            (
                HOST,
                "    if (queued.kind === 'notice') {\n"
                "      throw new Error(\n"
                "        'that is not a message to cancel: this app put it there to report something that ' +\n"
                "          'happened, and taking it back would leave this conversation never told',\n"
                "      )\n"
                "    }\n",
                "",
            )
        ],
    ),
    # ── D · what the row says ─────────────────────────────────────────────────────────────────
    (
        "M7 · ⚠️ **the held row signs itself *You* again** · the wire carries the subject, the "
        "controls are gone, and the heading still names the reader — which is `214`'s defect "
        "surviving its own fix in the one position a person reads first",
        [
            (
                QUEUED,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the heading asks the notice, then the go-ahead (R22); deleting the
                # notice's line leaves *You* on the notice's row, which is the row's defect, unchanged.
                "  if (props.item.appNotice !== undefined) return THE_APP_IS_THE_AUTHOR\n",
                "",
            )
        ],
    ),
    # RETIREMENT APPROVED — 624 M8: anchor-absent; removed by 89ee4f80690d2a474e5e4505df13da59089351a5.
    # The notice caption, its computed meaning and its rendering were deliberately removed; the heading
    # and full injected words remain. agent-cards-keep-their-words-without-the-caption.dom.test.ts
    # explicitly protects the caption-free view. Retargeting to a heading would change a caption-specific
    # mutation's meaning. Definition retained as historical evidence; no row execution.
    (
        "M8 · ⛔ **the caption is the GO-AHEAD's** · the entry exists, the heading is right, and "
        "the line under the words says *BroBot sent this when you pressed 'Start work on this "
        "plan'* — which is `HO-095` §6.3 exactly: a caption written for one feature reused on "
        "another, standing rule 8.1's class. ⚑ It is the row that proves the WORD is what fixed "
        "this and not a better sentence. ⚠️ **The sentence is INLINED rather than imported**, "
        "because an unresolved identifier would red the render with a `ReferenceError` — a kill "
        "for the wrong reason, which is `268 §1`'s lesson about a mutant that cannot run",
        [
            (
                ENTRY,
                "const why = computed(() => noticeMeans(props.item.notice))",
                "const why = computed(\n"
                "  () =>\n"
                "    'BroBot sent this when you pressed \u201cStart work on this plan\u201d. You did not write it \u2014 the setting change on its own starts no turn, so the agent would not have heard anything.',\n"
                ")",
            )
        ],
    ),
    # ── E · the stall report ──────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 **the report contradicts itself again** · *its turn ended and it replied nothing*, "
        "three lines above `614`'s quotation of what the agent actually said. ⛔ `HO-095` §3 "
        "traces what that pair cost end to end: a false stall woke BroBot, took a turn to "
        "disprove, and ended with a FALSE LESSON written to its permanent memory — *a deliberately "
        "parked agent is indistinguishable from a broken one in this app*",
        [
            (
                TASKS,
                "  turn_ended: 'its turn ended with this work still open.',",
                "  turn_ended: 'its turn ended and it replied nothing.',",
            )
        ],
    ),
    (
        "M10 · ⛔ **the report names the agent by its conversation id** · *Task #1 with "
        "`sess_a2d504f1…`*, and the quotation line under it says the same handle twice. ⚑ "
        "`HO-095` §5.3's answer was three words — *That is Ada. Say Ada.* — and this is the row "
        "that keeps the naming read on the path instead of leaving the composer to print what it "
        "was handed",
        # ⚑ **Anchor corrected in place by `703`**, whose own taking back reads the same name
        # on a line of the same spelling. ⛔ **The DEFECT is unchanged** — the push's report
        # names the conversation by its handle — and the line before it is what makes it the
        # push's. Re-verified RED individually against `what-the-child-actually-said.test.ts`.
        # ⚑ T-003 · re-anchored in place, not retired — D-012 reads the last exchange
        # (`lastExchange`) on the line above; the holder is still named by
        # `whatToCallTheConversation`. Its old killer (`what-the-child-actually-said.test.ts`) was
        # deleted by D-012; killed by the test T-003 added.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the stall notice names the holder by the conversation's name and never by its
        # `sess_` id. In the piece model the call site is `undrivenWorkText(piece, cause,
        # lastExchange(piece.owner), this.whatToCallTheConversation(piece.owner), ...)`, so the
        # plant hands the raw `piece.owner` id where the name goes. Killed by
        # `a-giver-looks-closer.test.ts`.
        [
            # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
            (HOST, "          this.theExchangeShownWith(piece),\n          this.whatToCallTheConversation(piece.owner),", "          this.theExchangeShownWith(piece),\n          piece.owner,"),
        ],
    ),
    (
        "M11 · ⚠️ **the ids come back into the description** · the opening line carries the task "
        "id and the conversation id beside a name that already says which agent it is, which is "
        "`HO-092` §2 on the surface `HO-095` §5.3 names. ⛔ Both are duplication of fields the "
        "`WorkReport` beside this prose already carries — the row can be pressed on, the sentence "
        "cannot",
                # ⚑ **705 · re-anchored in place** — the number is asked of `taskCalled` now (R38).
                # ⚑ **707 · re-anchored in place, not retired** — R40 spells the task for its reader (`taskCalledFrom`); the row still puts both ids back into the description.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The stalled-work
        # notice's opening line still names the agent and must not carry ids; D-016 only dropped the
        # project argument, so `taskCalledFrom(task.number, task.projectSlug, readersProject)`
        # became `taskCalled(task.number)`. The plant puts the task id and conversation id back
        # beside the name on the new line.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the stall notice's first line is exactly `<label> <title> with <holder> is not
        # being worked on: <said>` and carries no internal ids. In `reply-rails.ts` that line is now
        # built with `pieceLine(piece.label, piece.title)`. The plant adds the piece id and swaps
        # the holder's name for the raw owner id. Killed by `a-message-says-who-wrote-it.test.ts`.
        [
            # ⚑ **F074 · re-anchored in place, not retired** — F074 · the head line drops *is not being worked on* for a usage limit; the row still brings the ids back into it.
            (RAILS, "`${pieceLine(piece.label, piece.title)} with ${holder}${notWorkedOn}: ${said}`", "`${pieceLine(piece.label, piece.title)} (${piece.piece}) with ${piece.owner}${notWorkedOn}: ${said}`"),
        ],
    ),
    # ── F · the carrier's own sentence ────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** proposal-rails.ts
        # (`THE_THING_DECIDED_ON`, `SHAPE_CREATES`, the decision sentence) was deleted in bd70d693,
        # so the file is gone (count_now -1) and no sentence about a proposal's decision remains.
        # The 'no opaque id in a person's line' idea is covered for the surviving sentence by M11.
        # Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ **the proposal id returns to a person's line** · `prop_3305e717…` in the middle "
        "of a sentence about a decision somebody just made (`HO-095` §6.4). ⛔ No agent tool takes "
        "one — `agent-tools.ts`: *there is deliberately no `decideProposal` here* — so the id had "
        "no act behind it in either audience, and the claim that justified it (*what a later tool "
        "call can quote*) was false when it was written",
        [
            (
                PROPOSALS,
                "    `A person decided on ${THE_THING_DECIDED_ON[SHAPE_CREATES[proposal.shape]]} you proposed, ${proposal.name}.`,",
                "    `A person decided on ${THE_THING_DECIDED_ON[SHAPE_CREATES[proposal.shape]]} you proposed, ${proposal.name}, quoting ${proposal.proposalId}.`,",
            )
        ],
    ),
    # ── G · the edge this table cannot kill ───────────────────────────────────────────────────
    (
        "M13 · ⛔ **EXPECTED SURVIVOR · the belt goes** · the first conjunction stops asking about "
        "the subject, so a window that ever passed one would have its turn credited to the person "
        "— `413` §3's *the dangerous default is the one that credits a person with words they "
        "never wrote*. ⚠️ **No caller passes a notice from a window today**, exactly as none "
        "passes a `report` from one, so nothing in four vitest projects can reach the branch. ⚑ "
        "Kept because a table that only carries rows it can kill has stopped measuring its own "
        "edges (`278 M12`'s shape)",
        [
            (
                HOST,
                "    appNotice === undefined &&\n    aPersonTypedIt(by)\n",
                "    aPersonTypedIt(by)\n",
            )
        ],
    ),
]
