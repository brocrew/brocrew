"""688 · Draw who wrote it, and which task — `687`'s facts on the cards, R22 + R33's held go-ahead,
and two of `685`'s own (F3 and O1).

⚑ **The PM's §1:** `687` handed the cards what they could not say — who wrote a held row (R22),
what an agent said a message is (H1), the task's number on both ends (H2, H6). **§2:** a held plan
go-ahead is BroBot's words and has its own entry; a person may take it back from there (R33), and
what follows is the state `060`/`670` already name, in main's own words. **§3:** no green *All
clear* beside an amber line (F3); *Its own instructions* in the sheet's registers (O1).

## 🔴 What has to be killable

 * `M1`–`M4` 🔴 **R22 · the fold**: the held go-ahead not marked, on the queued row or on the
   ending a paged window rebuilds from; the predicate blind to a subject, or to the authorship.
 * `M5`–`M7` 🔴 **H1 · the fold**: an undeclared turn read as *question*; the held row's word, or
   the turn's, dropped.
 * `M8`–`M12` 🔴 **H6 / H2 · the fold**: the flushed turn's own number ignored; a zero or a fraction
   taken for a number; the sender's card handed no task, or a forged number.
 * `M13`, `M14` ⚑ **H2 · the card**: the reader or the template drops *Task #N*.
 * `M15`–`M25`, `M47` 🔴 **R22 + R33 · the row**: *You* over BroBot's words; the person's *Cancel
   it* on them; the take-back gone, or naming no row; the person's own *Cancel it* naming no row;
   the taken-back state worded as the person's cancel; main's sentence gone, or drawn over a
   conversation that ended; the held why gone; the held row's *question* gone; the sentence's
   first letter left lower-case; a nameless row offering a *Cancel it* that takes back the head
   (`M47`, from `688`'s review).
 * `M26` ⚑ **H1 · the incoming card**: the word gone.
 * `M27`–`M29` 🔴 **R33 · the press up the screen**: the list or the pane drops the row's name; the
   screen takes back the HEAD whichever row was pressed (`M29` is a source census — no test mounts
   `RuntimeScreen`).
 * `M30`–`M33` 🔴 **R22 · the composer**: *cancel yours* while the app's message also waits; the
   fact never handed down; the foot or the button title still pointing at *Cancel it*.
 * `M34`–`M38` 🔴 **F3**: green beside the wall; stopped work not an amber line; the wall not one;
   *Nothing* drawn green; a quiet page with no line made neutral.
 * `M39`–`M42` ⚑ **O1**: the heading, the note, the error ink, the line's margin.
 * `M43`–`M46` ⚑ **the export and main's bytes**: the held go-ahead signed *the person*; what followed a
   take-back dropped; a held report signed as the person's or the child's; the renderer's copy of
   main's sentence drifting — ⚑ since 700 the ONE value in `shared/the-go-ahead.ts` drifting, the
   renderer's copy being gone (`688` H2; M46 corrected in place).

## ⚠️ One row SURVIVED its first run, and its killer was added

 * `M12` — the fold's bound on a RECEIPT's number: no test handed the sender's card a forged one, so
   an unbounded read drew *Task* either way. ⚑ `who-wrote-it-and-which-task.render.test.ts` §4 now
   folds five forged receipts beside a numbered control (`688`'s review found it too).

## ⛔ What this table cannot reach

 * ⚠️ **`682`'s drawing (`688` §1b)** — `682` is not on `main` when this table was written; the
   response lists it under GAPs.
 * ⚠️ **The composer's foot through the real host**: the Fake parks every turn on a card, so a
   window holding a go-ahead behind it is FROZEN; the host test pins the disclosure the foot reads,
   and the DOM test pins the foot.
 * ⚠️ **The photographs** are evidence, not assertions.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, never a tree a dev server watches, and no `mutations.txt` exists.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 lifted the composer's one-held-message limit (it queues behind whatever waits, whoever wrote it):
M30–M33 are retired by ruling with the not-yours predicate, foot and title they guarded.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
TESTS = "apps/desktop/test"

FOLD = f"{LIB}/transcript.ts"
CARD = f"{LIB}/outgoing-card.ts"
EXPORT = f"{LIB}/readable-export.ts"
# ⚑ 700 · `688` H2 — where the go-ahead's sentence lives now (M46).
SHARED_GO_AHEAD = "apps/desktop/src/shared/the-go-ahead.ts"
QUEUEDMESSAGE = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
PIECE_CALLED = "apps/desktop/src/shared/piece-called.ts"
OUTGOING_CARD = "apps/desktop/src/renderer/src/lib/outgoing-card.ts"
OUTGOINGENTRY = "apps/desktop/src/renderer/src/components/OutgoingEntry.vue"
ATTENTION = f"{LIB}/home-attention.ts"
HELD = f"{COMPONENTS}/QueuedMessage.vue"
RELAYED = f"{COMPONENTS}/RelayedEntry.vue"
OUTGOING = f"{COMPONENTS}/OutgoingEntry.vue"
LIST = f"{COMPONENTS}/TranscriptView.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
COMPOSER = f"{COMPONENTS}/PromptComposer.vue"
WAITING = f"{COMPONENTS}/WaitingOnYou.vue"
OWN = f"{COMPONENTS}/OwnInstructions.vue"

HOST = "who-wrote-it-and-which-task.render.test.ts"
DOM = "who-wrote-it-and-which-task.dom.test.ts"

MUTATIONS = [
    # ── R22 · the fold ──────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the held go-ahead is not marked** · the row a person reads first draws *You* and "
        f"*Cancel it* over BroBot's words (R22) — killed by `{HOST}`",
        [
            (
                FOLD,
                "        // 🔴 **688 · R22** — see {@link QueuedItem.goAhead}: BroBot's go-ahead, never the person's.\n"
                "        ...(isTheGoAhead(event) ? { goAhead: true as const } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M2 · 🔴 **a paged window rebuilds a taken-back go-ahead as the person's** · *Put it back in "
        f"the composer* under BroBot's sentence — killed by `{HOST}`",
        [
            (
                FOLD,
                "        // back as the person's words with *Put it back in the composer* under BroBot's sentence.\n"
                "        ...(isTheGoAhead(event) ? { goAhead: true as const } : {}),\n",
                "        // back as the person's words with *Put it back in the composer* under BroBot's sentence.\n",
            )
        ],
    ),
    (
        "M3 · ⛔ **the predicate is blind to a subject** · a held REPORT, `app_authored` since `687`, "
        f"drawn as BroBot's go-ahead — killed by `{HOST}`",
        [(FOLD, "    !isAWorkReport(event.work) &&\n", "")],
    ),
    (
        "M4 · ⛔ **the predicate is blind to the authorship** · the person's own held message drawn as "
        f"BroBot's go-ahead — killed by `{HOST}`",
        [(FOLD, "    event.attribution === 'app_authored' &&\n", "")],
    ),
    # ── H1 · the fold ───────────────────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 **an undeclared turn read as *question*** · a routed question and a row written before "
        f"`687` say a word nobody said (`687` H1: *never a question*) — killed by `{HOST}`",
        [
            (
                FOLD,
                "          isAgentMessageKind(event.says) ? event.says : undefined,\n",
                "          isAgentMessageKind(event.says) ? event.says : 'question',\n",
            )
        ],
    ),
    (
        "M6 · ⚑ **the held row drops what the sender said** · it goes on saying nothing while it waits — "
        f"killed by `{HOST}`",
        [
            (
                FOLD,
                "        // ⚑ **688 · what the sender said it is** — only where the relay was read, like the name.\n"
                "        ...(wasRelayed(event.relayedFrom) && isAgentMessageKind(event.says)\n"
                "          ? { says: event.says }\n"
                "          : {}),\n",
                "",
            )
        ],
    ),
    (
        f"M7 · ⚑ **the turn drops what the sender said** — killed by `{HOST}`",
        [
            (
                FOLD,
                "    ...(says === undefined ? {} : { says }),\n",
                "",
            )
        ],
    ),
    # ── H6 / H2 · the fold ──────────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 **the flushed turn's own number is ignored** · a page that starts at the flushed turn "
        f"says *Task* (`687` H6) — killed by `{HOST}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The fold now
        # reads a piece LABEL, not a task number: `openedAPiece` takes `isALabel(itsOwnLabel) ?
        # itsOwnLabel : given?.label`, which is the same 'the flushed turn's own name is used when
        # the page starts at that turn' rule (687 H6, D-016 R4) after 'tasks to pieces'. Dropping
        # the own-label arm leaves `turn.opened` as `{}` on a page that begins at the flushed turn,
        # which the render test's section 5 asserts as `{ label: next }`. Killed by
        # `who-wrote-it-and-which-task.render.test.ts`.
        [
            (TRANSCRIPT, '  const label = isALabel(itsOwnLabel) ? itsOwnLabel : given?.label\n', '  const label = given?.label\n'),
        ],
    ),
    (
        "M9 · ⛔ **a zero is taken for a number** · *Task #0* on a turn a hand-edited row forged — "
        f"killed by `{HOST}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'A zero is
        # taken for a number' survives as 'a forged W0 / W1.0 is taken for a label': the number
        # check (`isATaskNumber`) is gone, and the zero rule now lives in the strict regex of
        # `pieceNumbersOf` in shared/piece-called.ts (every n >= 1, no leading zero), reached
        # through `isALabel`. The plant lets a zero segment through while still rejecting W01, so
        # only the forged-zero cases of the render test go red; the test's forged lists
        # `[0,'W0','W1.0','8',null]` and the `isALabel` false list `['W0','W1.0',...]` assert
        # exactly this. Killed by `who-wrote-it-and-which-task.render.test.ts`.
        [
            (PIECE_CALLED, '  if (!/^W[1-9][0-9]*(\\.[1-9][0-9]*)*$/.test(label)) return null\n', '  if (!/^W(0|[1-9][0-9]*)(\\.(0|[1-9][0-9]*))*$/.test(label)) return null\n'),
        ],
    ),
    (
        f"M10 · ⛔ **a fraction is taken for a number** · *Task #2.5* — killed by `{HOST}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (a fraction is taken for a number, 'Task #2.5') lost its concept: labels are now
        # W<n>(.<n>)* and the regex /^W[1-9][0-9]*(\.[1-9][0-9]*)*$/ admits digits and dots only, so
        # no fraction reaches the final check. The live analogue is pieceNumbersOf in
        # piece-called.ts refusing a segment that is not a safe integer (one past 2^53). Plant:
        # Number.isSafeInteger becomes Number.isFinite, so 'W9007199254740993' and
        # 'W1.9007199254740993' parse to numbers that are not exact. No existing test uses such a
        # segment (two-bounds.test.ts ~line 375 uses WNaN and W1.Infinity, which the regex rejects
        # first). MISSING TEST: a pure test of pieceNumbersOf asserting 'W9007199254740993' and
        # 'W1.9007199254740993' are null; paired positives 'W9007199254740991' gives
        # [9007199254740991] and 'W12.3.40' gives [12,3,40]. ⚠️ No test kills it yet: the landing
        # owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — pieceNumbersOf must refuse a
        # label whose component is finite but not an exact integer (past 2^53): the regex admits
        # digits only, and only Number.isSafeInteger stops W9007199254740993 from parsing to the
        # wrong number. two-bounds.test.ts uses WNaN and W1.Infinity, which the regex already
        # rejects, so nothing reaches the final check. A pure test on the exported function kills
        # the plant cleanly. Killed by `what-the-tree-landing-left-unpinned.test.ts`.
        [
            (PIECE_CALLED, '  return numbers.every(Number.isSafeInteger) ? numbers : null\n', '  return numbers.every(Number.isFinite) ? numbers : null\n'),
        ],
    ),
    (
        "M11 · 🔴 **the sender's card is handed no task** · *Task #N* only ever on the recipient's end "
        f"(`687` H2) — killed by `{HOST}`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 718 — `707` GAP-2: the task the receipt names now carries
        # its project beside its number (`elsewhere`), so the block spans more lines. The defect
        # planted is unchanged: the sender's card is handed no task at all.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The sender's card is
        # still handed its task through the `message_sent` fold; D-016 only removed the `elsewhere`
        # field, so the block shrank to a three-line ternary. The plant removes that whole block, so
        # the sender's card gets no `opened` at all.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'The sender's
        # card is handed no task' is now 'the sender's card is handed no piece': the message_sent
        # arm of the fold still attaches `about: { label }` to the sender's row, but keyed on
        # `isAnId(event.piece)` and `isALabel(event.label)` (the receipt's `taskId/taskNumber`
        # became `piece/label`). Removing the whole three-line spread leaves `sent.about` undefined,
        # so `pieceSays` returns null and the follow-up card names no piece, which section 4 of the
        # render test asserts. Killed by `who-wrote-it-and-which-task.render.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The message_sent object moved two spaces left; keep the same field omission or trust-boundary bypass.
            (TRANSCRIPT, "        ...(isAnId(event.piece)\n          ? { about: isALabel(event.label) ? { label: event.label } : {} }\n          : {}),\n", ""),
        ],
    ),
    (
        "M12 · ⛔ **a forged number reaches the sender's card** · *Task #0*, *Task #2.5*, *Task #8* from "
        f"a receipt edited on disk — killed by `{HOST}`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 718 — `707` GAP-2 reshaped the block (see M11). The defect
        # planted is unchanged: any number the receipt holds reaches the card, unchecked.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — A forged or malformed
        # `taskNumber` must still not reach the sender's card, and `isATaskNumber(event.taskNumber)`
        # is still the guard, now on a single line. The plant loosens it to `!== undefined`, so 0,
        # -3, 2.5, '8' and null would be drawn as numbers.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'A forged
        # number reaches the sender's card' is now 'a forged label reaches it': the guard on the
        # receipt's label in the message_sent arm is `isALabel(event.label)`, and the render test
        # still feeds it forged values (0, 'W0', 'W1.0', '8', null, and for the turn also 'Task #9'
        # and NaN). Weakening the guard to `event.label !== undefined` lets each of those through,
        # so the card would draw W0 or a stray string instead of the plain 'Piece'. The short guard
        # text occurs twice in transcript.ts, so the anchor keeps the `? { about:` prefix, which
        # occurs once. Killed by `who-wrote-it-and-which-task.render.test.ts`.
        [
            (TRANSCRIPT, '? { about: isALabel(event.label) ? { label: event.label } : {} }', '? { about: event.label !== undefined ? { label: event.label } : {} }'),
        ],
    ),
    # ── H2 · the card ───────────────────────────────────────────────────────────────────────────
    (
        f"M13 · ⚑ **the reader drops the task** — killed by `{HOST}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'The reader
        # drops the task' survives as 'the reader drops the piece': `outgoing-card.ts` builds the
        # card's `piece: pieceSays(sent?.about)` where it used to build `task:
        # openedTaskSays(sent?.opened)`, per 'tasks to pieces'. Forcing it to null leaves the
        # sender's card with no piece line while the fold still carries the label, which the render
        # test asserts. Killed by `who-wrote-it-and-which-task.render.test.ts`.
        [
            (OUTGOING_CARD, '    piece: pieceSays(sent?.about),\n', '    piece: null,\n'),
        ],
    ),
    (
        f"M14 · ⚑ **the template draws only a reply's task** — killed by `{DOM}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'The template
        # draws only a reply's task' is now 'draws only the facts': OutgoingEntry.vue's line is
        # `<strong v-if="card.facts || card.piece" class="task" data-cy="outgoing-task">`, the same
        # shape with the field renamed. Dropping the piece arm hides the piece line on a card that
        # has no facts, which the DOM test's section 5 (`['W1.8','Piece',null]`) reads through
        # `data-cy=outgoing-task`. The old row cited the whole tag, but the short `v-if` text is
        # unique in the file. Killed by `who-wrote-it-and-which-task.dom.test.ts`.
        [
            (OUTGOINGENTRY, 'v-if="card.facts || card.piece"', 'v-if="card.facts"'),
        ],
    ),
    # ── R22 + R33 · the row ─────────────────────────────────────────────────────────────────────
    (
        f"M15 · 🔴 ***You* over BroBot's go-ahead** (R22) — killed by `{HOST}`",
        [
            (
                HELD,
                "  return props.item.goAhead === true ? GO_AHEAD_SENDER : 'You'\n",
                "  return 'You'\n",
            )
        ],
    ),
    (
        "M16 · 🔴 **the person's *Cancel it* on BroBot's go-ahead** · and *Put it back in the "
        f"composer* once it ends (R22) — killed by `{HOST}`",
        [(HELD, "    props.item.goAhead === true,\n)\n", "    false,\n)\n")],
    ),
    (
        f"M17 · 🔴 **the go-ahead's own take-back is gone** (R33) — killed by `{DOM}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — R33's rule (the go-ahead
        # has its own take-back control, never the person's plain Cancel it) is unchanged and the
        # exact `<div>` is still there with a matching inline '688 · R33' comment; only the guard's
        # TEXT changed, D-017 adding a `!untilItStarts &&` clause (R3: no take-back control while
        # nothing is running to take it back from). The old bare string no longer matches;
        # re-anchoring just needs the updated guard text.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — R33's rule is unchanged:
        # a held go-ahead has its own 'Take back the go-ahead' control, never the person's Cancel
        # it. D-017b renamed the guard clause `!untilItStarts` to `mayTakeItBack` in the same `<div
        # v-if>`, so only the anchor text moved. The plant is the row's own replacement,
        # `v-if="false"`.
        [
            (QUEUEDMESSAGE, '        <div\n          v-if="goAhead && waiting() && mayTakeItBack && item.messageId !== undefined"\n          class="msg-actions"\n        >', '        <div v-if="false" class="msg-actions">'),
        ],
    ),
    (
        "M18 · 🔴 **the take-back names no row** · the screen takes back the head of the mailbox, "
        f"which may be another message — killed by `{DOM}`",
        [
            (
                HELD,
                '            data-cy="take-back-go-ahead"\n'
                "            @click=\"emit('cancel', item.messageId)\"\n",
                '            data-cy="take-back-go-ahead"\n'
                "            @click=\"emit('cancel', undefined)\"\n",
            )
        ],
    ),
    (
        f"M19 · ⛔ **the person's own *Cancel it* names no row** — killed by `{DOM}`",
        [
            (
                HELD,
                '            data-cy="cancel-queued"\n'
                "            @click=\"emit('cancel', item.messageId)\"\n",
                '            data-cy="cancel-queued"\n'
                "            @click=\"emit('cancel', undefined)\"\n",
            )
        ],
    ),
    (
        "M20 · 🔴 **a taken-back go-ahead worded as the person's cancel** · *you cancelled it* about "
        f"words the person did not write — killed by `{HOST}`",
        [
            (
                HELD,
                "            <template v-else-if=\"item.outcome === 'cancelled' && goAhead\"\n",
                '            <template v-else-if="false"\n',
            )
        ],
    ),
    (
        "M21 · 🔴 **what follows a take-back is not said** · the state `060`/`670` name, in main's words "
        f"(R33) — killed by `{HOST}`",
        [
            (
                HELD,
                "          v-if=\"goAhead && item.outcome === 'cancelled'\"\n",
                '          v-if="false"\n',
            )
        ],
    ),
    (
        "M22 · ⛔ ***type your next message* to a conversation that ENDED** · the sentence on an "
        f"abandoned go-ahead — killed by `{HOST}`",
        [
            (
                HELD,
                "          v-if=\"goAhead && item.outcome === 'cancelled'\"\n",
                '          v-if="goAhead && item.outcome !== null"\n',
            )
        ],
    ),
    (
        f"M23 · ⚑ **the held go-ahead does not say why it waits** — killed by `{HOST}`",
        [
            (
                HELD,
                '        <p v-if="goAhead && waiting()" class="why" data-cy="queued-go-ahead-why">\n',
                '        <p v-if="false" class="why" data-cy="queued-go-ahead-why">\n',
            )
        ],
    ),
    (
        f"M24 · ⚑ **the held row drops *question*** (`687` H1) — killed by `{HOST}`",
        [
            (
                HELD,
                '            v-if="item.says && item.relayed && !item.report"\n',
                '            v-if="false"\n',
            )
        ],
    ),
    (
        "M25 · ⚑ **main's sentence drawn in lower case** · the first letter is raised by the style "
        f"and not in the bytes — killed by `{DOM}`",
        [(HELD, ".taken-back::first-letter {\n  text-transform: uppercase;\n}\n", "")],
    ),
    (
        "M47 · ⛔ **a nameless row offers *Cancel it* again** · a ledger before `354`: the press takes back "
        "the HEAD, a different message — BroBot's go-ahead since `670` (`688`'s review) — "
        f"killed by `{DOM}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same guard-text drift as
        # M17: the rule 'a nameless queued row (no `messageId`) must offer no Cancel it, because a
        # press on it would take back the mailbox HEAD, a different message' is unchanged and still
        # commented inline ('688 · only a row with a NAME'), but D-017 inserted `!untilItStarts &&`
        # into the same `v-if`, so the row's old bare string no longer matches.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds: a
        # nameless row (no `messageId`) offers no Cancel it, because the press would take back the
        # head of the mailbox, a different message. D-017b replaced `!untilItStarts` with
        # `mayTakeItBack` in the same guard. The plant drops only the `messageId` clause and keeps
        # `mayTakeItBack`, so it fails for the label's reason and not for the removed
        # recorded-conversation guard.
        [
            (QUEUEDMESSAGE, '            v-if="waiting() && mayTakeItBack && item.messageId !== undefined"\n', '            v-if="waiting() && mayTakeItBack"\n'),
        ],
    ),
    # ── H1 · the incoming card ──────────────────────────────────────────────────────────────────
    (
        f"M26 · ⚑ **the incoming card drops the sender's word** (`687` H1) — killed by `{HOST}`",
        [
            (
                RELAYED,
                '<span v-if="item.says" class="about" data-cy="relayed-says">',
                '<span v-if="false" class="about" data-cy="relayed-says">',
            )
        ],
    ),
    # ── R33 · the press up the screen ───────────────────────────────────────────────────────────
    (
        f"M27 · 🔴 **the list drops the pressed row's name** — killed by `{DOM}`",
        [
            (
                LIST,
                "          @cancel=\"(messageId) => $emit('cancelQueued', messageId)\"\n",
                "          @cancel=\"$emit('cancelQueued', undefined)\"\n",
            )
        ],
    ),
    (
        f"M28 · 🔴 **the pane drops the pressed row's name** — killed by `{DOM}`",
        [
            (
                PANE,
                "          @cancel-queued=\"(messageId) => emit('cancelQueued', messageId)\"\n",
                "          @cancel-queued=\"emit('cancelQueued', undefined)\"\n",
            )
        ],
    ),
    (
        "M29 · 🔴 **the screen takes back the HEAD whichever row was pressed** · R33's take-back could "
        "take back a question waiting in front of the go-ahead — "
        "killed by `the-message-that-has-no-name.test.ts`",
        [
            (
                SCREEN,
                "  if (id) void store.cancelQueuedMessage(id, messageId)\n",
                "  const held = active.value?.meta?.queued?.[0]\n"
                "  if (id && held) void store.cancelQueuedMessage(id, held.id)\n",
            )
        ],
    ),
    # ── R22 · the composer ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 retired by ruling what this row
        # protects. The row guards the `notYoursIsWaiting` predicate (any held message the app
        # wrote), and that predicate existed only because 'the composer refuses a second message
        # while ANYTHING waits' (688's review). Its anchor is left stale, so the census records it
        # retired (`anchor-absent`).
        "M30 · 🔴 ***cancel yours* while the app's message also waits** · the foot promises a queue that "
        f"cancelling the person's own does not open (`688`'s review) — killed by `{DOM}`",
        [
            (
                PANE,
                "  (props.record.meta?.queued ?? []).some((held) => held.attribution === 'app_authored'),\n",
                "  (props.record.meta?.queued ?? []).every((held) => held.attribution === 'app_authored'),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject is gone on purpose. Its
        # anchor is left stale, so the census records it retired (`anchor-absent`).
        f"M31 · ⚑ **the composer is never told** — killed by `{DOM}`",
        [(PANE, '          :not-yours-is-waiting="notYoursIsWaiting"\n', "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 deleted the foot branch this row
        # disables ('A message you did not write is already waiting … Wait for it to go before
        # queueing another'). It also deleted the sibling branch's 'Cancel it in the transcript
        # before queueing another'. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M32 · 🔴 **the foot points at a *Cancel it* R22 removed** · over BroBot's held go-ahead — "
        f"killed by `{DOM}`",
        [
            (
                COMPOSER,
                '        <template v-else-if="busyChoices && props.hasQueued && props.notYoursIsWaiting">\n',
                '        <template v-else-if="false">\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 deleted the Queue button's
        # `queueTaken ? (props.notYoursIsWaiting ? 'A message you did not write…Wait for it to go.'
        # : 'A message is already waiting… Cancel it in the transcript…')` title, and its
        # `:disabled="queueTaken"`, with the one-held-message limit. Its anchor is left stale, so
        # the census records it retired (`anchor-absent`).
        f"M33 · ⚑ **the queue button's title points at it too** — killed by `{DOM}`",
        [(COMPOSER, "                ? props.notYoursIsWaiting\n", "                ? false\n")],
    ),
    # ── F3 ──────────────────────────────────────────────────────────────────────────────────────
    (
        "M34 · 🔴 **a green *All clear* beside the amber wall** (`688` §3.1, ruled) — "
        f"killed by `{DOM}`",
        [
            (
                ATTENTION,
                "  return attention.quiet && anAmberLineStands\n",
                "  return false\n",
            )
        ],
    ),
    (
        f"M35 · ⛔ **stopped work is not an amber line** — killed by `{DOM}`",
        [
            (
                WAITING,
                # ⚑ **W4.584 · re-anchored in place, not retired** — the amber line also stands for a helper's stopped piece; the plant still drops the stalled work from it
                # ⚑ **what waits on a person · re-anchored in place, not retired** — the amber line also stands for a piece that needs a look; the plant still drops the stalled work from it
                "    (persons.limits.value?.walls.length ?? 0) > 0 ||\n    incidents.value.rows.length > 0 ||\n    (persons.stalled.value?.rows.length ?? 0) > 0 ||\n    (persons.stopped.value?.rows.length ?? 0) > 0,\n",
                "    (persons.limits.value?.walls.length ?? 0) > 0 ||\n    incidents.value.rows.length > 0 ||\n    (persons.stopped.value?.rows.length ?? 0) > 0,\n",
            )
        ],
    ),
    (
        "M36 · ⛔ **the wall is not an amber line** — "
        "killed by `a-wall-he-finds-out-about.dom.test.ts`",
        [
            (
                WAITING,
                # ⚑ **W4.584 · re-anchored in place, not retired** — the amber line also stands for a helper's stopped piece; the plant still drops the wall from it
                # ⚑ **what waits on a person · re-anchored in place, not retired** — the amber line also stands for a piece that needs a look; the plant still drops the wall from it
                "    (persons.limits.value?.walls.length ?? 0) > 0 ||\n    incidents.value.rows.length > 0 ||\n    (persons.stalled.value?.rows.length ?? 0) > 0 ||\n    (persons.stopped.value?.rows.length ?? 0) > 0,\n",
                "    incidents.value.rows.length > 0 ||\n    (persons.stalled.value?.rows.length ?? 0) > 0 ||\n    (persons.stopped.value?.rows.length ?? 0) > 0,\n",
            )
        ],
    ),
    (
        f"M37 · 🔴 ***Nothing* drawn GREEN** · the word moved and the tone did not — killed by `{DOM}`",
        [
            (
                ATTENTION,
                "    ? { stat: NOTHING_OWED, tone: null }\n",
                "    ? { stat: NOTHING_OWED, tone: attention.statTone }\n",
            )
        ],
    ),
    (
        "M38 · ⛔ **a quiet page with no line made neutral** · the green *All clear* is the true answer "
        "there — killed by `a-wall-he-finds-out-about.dom.test.ts`",
        [
            (
                WAITING,
                # ⚑ **W4.584 · re-anchored in place, not retired** — the amber line also stands for a helper's stopped piece; the plant still makes a quiet page with no line neutral
                # ⚑ **what waits on a person · re-anchored in place, not retired** — the amber line also stands for a piece that needs a look; the plant still makes a quiet page with no line neutral
                "    (persons.limits.value?.walls.length ?? 0) > 0 ||\n    incidents.value.rows.length > 0 ||\n    (persons.stalled.value?.rows.length ?? 0) > 0 ||\n    (persons.stopped.value?.rows.length ?? 0) > 0,\n",
                "    true,\n",
            )
        ],
    ),
    # ── O1 ──────────────────────────────────────────────────────────────────────────────────────
    (
        f"M39 · ⚑ **the heading is not the sheet's label** — killed by `{DOM}`",
        [
            (
                OWN,
                "  letter-spacing: 0.06em;\n  text-transform: uppercase;\n}\n\n.identity-note {\n",
                "}\n\n.identity-note {\n",
            )
        ],
    ),
    (
        f"M40 · ⚑ **the note is not the sheet's note** — killed by `{DOM}`",
        [
            (
                OWN,
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                ".identity-note {\n  margin: 0;\n  color: var(--muted);\n  font-size: var(--type-caption);\n  line-height: 1.5;\n}\n",
                "",
            )
        ],
    ),
    (
        f"M41 · ⚑ **an unreadable read in the default ink** — killed by `{DOM}`",
        [(OWN, ".sheet-state.err {\n  color: var(--danger);\n}\n", "")],
    ),
    (
        f"M42 · ⚑ **a state line with the browser's margins** — killed by `{DOM}`",
        [
            (
                OWN,
                ".sheet-state {\n  display: flex;\n  align-items: center;\n  margin: 0;\n",
                ".sheet-state {\n  display: flex;\n  align-items: center;\n",
            )
        ],
    ),
    # ── the export, and main's bytes ────────────────────────────────────────────────────────────
    (
        "M43 · 🔴 **the export signs BroBot's go-ahead *the person*** · `633`'s *the same as what the ui "
        f"shows* — killed by `{HOST}`",
        # ⚑ A0 · re-anchored in place, not retired — a person is `You` in the export now, never a
        # name; the plant still signs BroBot's go-ahead as the person.
        [
            (
                EXPORT,
                "              : item.goAhead === true\n"
                "                ? (AUTHOR.continuation ?? GO_AHEAD_SENDER)\n"
                "                : (AUTHOR.queued ?? 'You'),\n",
                "              : (AUTHOR.queued ?? 'You'),\n",
            )
        ],
    ),
    (
        f"M44 · ⚑ **the export drops what followed a take-back** — killed by `{HOST}`",
        [
            (
                EXPORT,
                "            : item.goAhead === true && item.outcome === 'cancelled'\n"
                "              ? `you took it back — ${THE_GO_AHEAD_WAS_NOT_SENT}`\n"
                "              : `this message was ${item.outcome}`\n",
                "            : `this message was ${item.outcome}`\n",
            )
        ],
    ),
    (
        "M45 · ⛔ **the export signs a held REPORT as somebody else's** · *the person* for a stall report, "
        "the child for its own reply, where the screen heads both as the work (`406`, `688`'s "
        f"review) — killed by `{HOST}`",
        [
            (
                EXPORT,
                "        item.report !== undefined\n"
                "          ? (AUTHOR.workReport ?? WORK_REPORT_MARK)\n"
                "          : item.relayed === true\n",
                "        item.relayed === true\n",
            )
        ],
    ),
    (
        "M46 · 🔴 **the renderer's copy of main's sentence drifts** · *never a new word for it* (R33) — "
        f"killed by `{HOST}` · ⚑ ANCHOR CORRECTED IN PLACE BY 700: `688` H2 moved the one value to "
        "`shared/the-go-ahead.ts` and the renderer's copy is gone, so the drift now moves main's error "
        "and the row's line together — the row's literal bytes still catch it",
        [
            (
                SHARED_GO_AHEAD,
                "export const THE_GO_AHEAD_WAS_NOT_SENT = 'the plan was released but the go-ahead was not sent'\n",
                "export const THE_GO_AHEAD_WAS_NOT_SENT = 'the plan was ended but the go-ahead was not sent'\n",
            )
        ],
    ),
]
