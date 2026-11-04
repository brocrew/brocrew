"""687 · what the cards cannot say yet — R22's field, and `678` H1, H2, H6.

⛔ **Ordered by the PM's ruling R22** (`670` F-a: a held go-ahead is BroBot's words, so its queued
row says app-authored with no subject) **and the frontend's `678` hand-backs**: H1 a card cannot say
*question* positively, H2 the sender's card cannot say *Task #N*, H6 a held task's flushed turn
reads *Task*.

## ⚠️ What a row here measures

 * ⚑ **M1–M3 are the declaration's writer** — `whoseWordsTheseAre`'s `says`, and the predicate it
   is written on (an AGENT's conversation, asked of `by` and never of the relay) — killed by
   `what-the-cards-cannot-say-yet.test.ts` §2 and `words-the-person-did-not-say.test.ts` §2.
 * ⚑ **M4–M7 are R22** — the held row and three of its endings carrying the authorship WHOLE —
   killed by the same file's §1.
 * ⚑ **M8–M10 and M17 are the declaration's journey** — to the idle turn through `sendAs`, onto the
   held entry, and through the flush — killed by §2.
 * ⚑ **M11–M16 and M18 are the number** — returned by `recordAssignment`, handed to both receipts,
   written onto the held entry and spread onto its flushed turn — killed by §3 and §4, whose
   numbers are burned past `1` first so a constant cannot pass.
 * ⚑ **M19–M31 were added for the review's first round**: the sign-in ending (reached by `648`'s own
   fixture, which the first draft of this docstring wrongly said nothing reaches); the launch sweep
   — the SIXTH writer of a held row's ending, which every dispatch before this one missed; the
   composer's disclosure; the replayed number's bound; and one *"stamps every row"* mutant per
   writer, each killed by the control that plants the person's own row beside BroBot's.

## ⛔ What this table cannot reach

 * ⚠️ **`recordAssignment`'s `null` when numbering FAILS** — the store's own invariant calls that
   unreachable, and no fixture makes `allocateProjectNumber` throw.
 * 🔴 **The DRAWING.** Every row is killed at main's side of the wire; what a card shows is the
   frontend's, after this lands.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
QUEUED = "apps/desktop/src/main/runtime/queued-message.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 the declaration is never written · killed by `what-the-cards-cannot-say-yet.test.ts` §2",
        [(HOST, "    ...(says === undefined || sessionSpeakingAs(by) === null ? {} : { says }),\n", "")],
    ),
    (
        "M2 · ⛔ the declaration is written for EVERY caller — a reply, a notice, a routed question "
        "all say `question` · killed by `what-the-cards-cannot-say-yet.test.ts` §2's controls and `words-the-person-did-not-say.test.ts` §2",
        [
            (
                HOST,
                "    ...(says === undefined || sessionSpeakingAs(by) === null ? {} : { says }),\n",
                "    ...(says === undefined ? {} : { says }),\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ the declaration is read off the RELAY instead of the caller — the tempting spelling, "
        "which puts `question` on a question BroBot routed for a child · killed by `what-the-cards-cannot-say-yet.test.ts` §2's routed control",
        [
            (
                HOST,
                "    ...(says === undefined || sessionSpeakingAs(by) === null ? {} : { says }),\n",
                "    ...(says === undefined || wroteIt === undefined ? {} : { says }),\n",
            )
        ],
    ),
    (
        "M4 · 🔴 R22 undone on the HELD row — `attribution` taken off again, and the go-ahead is the "
        "person's shape · killed by `what-the-cards-cannot-say-yet.test.ts` §1",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same site and same
        # reasoning as M31 (R22 survives, only the anchor needs the extra context to stay unique
        # against the new second occurrence in `holdForTheNextStart`). This mutant strips
        # `attribution` back off instead of forcing it, undoing R22 in the other direction.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R22 (the held
        # `message_queued` row carries the entry's own authorship, `attribution` included) survives;
        # the spread is unchanged but now followed by a D-016 piece comment, and
        # `...held.authorship,` also appears in `holdForTheNextStart`, so the anchor takes the
        # following comment line to stay unique. The plant strips `attribution` back off. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — Same
        # site and same cause as M31: the comment under `...held.authorship,` in queueMessage was
        # reworded, and two other `...held.authorship,` spreads exist, so the anchor takes the new
        # comment line (count 1). The plant strips `attribution` back off the held row, undoing R22
        # in the other direction. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '      ...held.authorship,\n      // ⚑ **D-016 · the piece a held brief gives or a held new brief names**, on the row read\n', '      ...(({ attribution: _w, ...subject }) => subject)(held.authorship),\n      // ⚑ **D-016 · the piece a held brief gives or a held new brief names**, on the row read\n'),
        ],
    ),
    (
        "M5 · ⛔ R22 undone on the CANCELLED ending — a rebuild from the ending alone is the person's "
        "again · killed by `what-the-cards-cannot-say-yet.test.ts` §1",
        [
            (
                HOST,
                "      // and a cancelled go-ahead — whose authorship IS `attribution` — rebuilt as the person's.\n"
                "      ...queued.authorship,\n",
                "      // and a cancelled go-ahead — whose authorship IS `attribution` — rebuilt as the person's.\n"
                "      ...(({ attribution: _w, ...subject }) => subject)(queued.authorship),\n",
            )
        ],
    ),
    (
        "M6 · ⛔ R22 undone on the ending a CLOSE writes · killed by `what-the-cards-cannot-say-yet.test.ts` §1",
        [
            (
                HOST,
                "        ...queued.authorship,\n      })\n    }\n",
                "        ...(({ attribution: _w, ...subject }) => subject)(queued.authorship),\n      })\n    }\n",
            )
        ],
    ),
    (
        "M7 · ⛔ R22 undone on the vanished-file ending · killed by `what-the-cards-cannot-say-yet.test.ts` §1",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — Same move as M29: the vanished-file ending is the refusal arm of readyToGo and now ends
        # `return null`. R22 (the ending carries the authorship whole) survives; the plant strips
        # `attribution` from it so an app-authored held row is rebuilt as the person's. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '        ...queued.authorship,\n      })\n      this.publishStateIfChanged(session)\n      return null\n', '        ...(({ attribution: _w, ...subject }) => subject)(queued.authorship),\n      })\n      this.publishStateIfChanged(session)\n      return null\n'),
        ],
    ),
    (
        "M8 · 🔴 the IDLE turn loses the declaration — `sendAs` asks with none · killed by `what-the-cards-cannot-say-yet.test.ts` §2",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # idle turn carries the caller's declared `says`) survives in `sendAs`, which reads
        # `how.says` only on the pass-it-on arm; the anchor moved because D-016 added `??
        # undefined`. The plant makes `declared` always undefined. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, "    const declared = how.ifItLosesTheRace === 'pass-it-on' ? (how.says ?? undefined) : undefined\n", '    const declared = undefined\n'),
        ],
    ),
    (
        "M9 · ⛔ `queueAs` hands the idle branch no declaration · killed by `what-the-cards-cannot-say-yet.test.ts` §2",
        [
            (
                HOST,
                "          ifItLosesTheRace: 'pass-it-on',\n          says,\n",
                "          ifItLosesTheRace: 'pass-it-on',\n          says: undefined as never,\n",
            )
        ],
    ),
    (
        "M10 · 🔴 the HELD entry loses the declaration — its row and its flushed turn say nothing · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §2",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The held entry
        # still takes its declaration through `whoseWordsTheseAre`; D-016 only added `?? undefined`
        # to the argument. The plant drops the `says` argument, so the held row and its flushed turn
        # say nothing. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '      authorship: whoseWordsTheseAre(by, this.profileOf, facts, says ?? undefined),\n', '      authorship: whoseWordsTheseAre(by, this.profileOf, facts),\n'),
        ],
    ),
    (
        "M11 · 🔴 the receipt carries no number · killed by `what-the-cards-cannot-say-yet.test.ts` §3",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # sender's receipt carries the label of the piece the message names) survives in
        # `noteTheSending`, which now spreads `{ piece, label }` from `about` where it spread
        # `taskNumber`. The plant keeps the piece id and drops the label. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '      ...(about === null ? {} : { piece: about.piece, label: about.label }),\n', '      ...(about === null ? {} : { piece: about.piece }),\n'),
        ],
    ),
    (
        "M12 · ⛔ the IDLE branch's receipt is handed no number · killed by `what-the-cards-cannot-say-yet.test.ts` §3",
                # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` GAP-2) added the receipt's project as a tenth argument; the row still hands the idle receipt no number.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The idle branch's
        # receipt still carries the assigned task number to the sender, and only the `taskElsewhere`
        # argument was removed by D-016, so the signature is now nine parameters on one line. The
        # plant is re-cut to hand `null` in place of `numbered` on that call.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The idle
        # branch of `queueMessage` still hands `noteTheSending` the piece the message named, now as
        # `facts.aboutPiece ?? null` where it handed `numbered`. The plant hands `null` there.
        # Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, "          'sent',\n          facts.aboutPiece ?? null,\n          null,\n", "          'sent',\n          null,\n          null,\n"),
        ],
    ),
    (
        "M13 · ⛔ the HELD branch's receipt is handed no number · killed by `what-the-cards-cannot-say-yet.test.ts` §3",
                # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` GAP-2) added the receipt's project as a tenth argument; the row still hands the held receipt no number.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The held branch's
        # receipt still carries the number through `noteTheSending`; D-016 removed only the trailing
        # `taskElsewhere` argument, so the call fits on one line. The plant is re-cut to hand `null`
        # in place of `numbered` on the queued call, the only other `noteTheSending(` call.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The held
        # branch of `queueMessage` passes `facts.aboutPiece ?? null` to `noteTheSending` on the
        # 'queued' call, where it passed `numbered`. The plant hands `null` there. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, "        'queued',\n        facts.aboutPiece ?? null,\n        id,\n", "        'queued',\n        null,\n        id,\n"),
        ],
    ),
    (
        "M14 · 🔴 `recordAssignment` answers a constant rather than the number it wrote · killed by "
        "`what-the-cards-cannot-say-yet.test.ts` §3 and §4, whose counters are burned past `1`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `recordAssignment` is gone, but the number it returned is now taken before the send in
        # `giveWork` (R4: `numberUnder`, then the label `${under.label}.${number}`). The plant makes
        # the give's label a constant ordinal, which passes only where the counter has not moved;
        # the rig burns numbers under the root. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '      label: `${under.label}.${String(number)}`,\n', '      label: `${under.label}.1`,\n'),
        ],
    ),
    (
        "M15 · ⛔ a QUESTION is answered a number — its receipt then says *Task #0* about nothing · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §3's control",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # question or note that names no piece carries no number) survives as 'a note naming no
        # piece carries neither piece nor label' (§3 THE CONTROL), where a guess would name the
        # recipient's piece. The plant makes the receipt name a valid-looking piece and label when
        # `about` is null, so the replay bound cannot hide it. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '      ...(about === null ? {} : { piece: about.piece, label: about.label }),\n      // 🔴 **Off the SLOT and never off the caller**', "      ...(about === null ? { piece: 'work_stray', label: 'W1.1' } : { piece: about.piece, label: about.label }),\n      // 🔴 **Off the SLOT and never off the caller**"),
        ],
    ),
    (
        "M16 · 🔴 the held entry is never numbered — its flushed turn says only *Task* · killed by `what-the-cards-cannot-say-yet.test.ts` §4",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The held entry
        # still carries the give's `{ piece, label }` so the flush can number the turn. The plant
        # keeps the piece id and drops the label from the entry. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # held entry still carries the piece and its label so the flush can number the turn; D-016c
        # widened the source to `carried = facts.giving ?? facts.rebriefing` and added
        # `...theRebriefMark`, so the old `giving === null` line matches nothing. The plant drops
        # `label` from the held entry; the flush (`queued.label === undefined` at the user_turn
        # build) then writes no piece or label, so the turn says only Task. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The held entry still carries the piece and its label so the flush can
        # number the turn; commit 6 added a drives spread between the piece spread and the origin
        # comment, so the old two-line anchor is gone. The plant drops the label from the held
        # entry, and the flush (which needs both piece and label) then writes neither, so the turn
        # says only Task. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '        : { piece: carried.piece, label: carried.label, ...theRebriefMark }),\n      ...(drives === null ? {} : { drives }),\n      // ⚑ **414** — see {@link QueuedMessage.origin}: the flush has no `by` to derive from.\n', '        : { piece: carried.piece, ...theRebriefMark }),\n      ...(drives === null ? {} : { drives }),\n      // ⚑ **414** — see {@link QueuedMessage.origin}: the flush has no `by` to derive from.\n'),
        ],
    ),
    (
        "M17 · ⛔ the flush drops the declaration off the turn it writes · killed by `what-the-cards-cannot-say-yet.test.ts` §2",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The flush
        # still builds the turn from `...queued.authorship`; only the trailing comment changed ('the
        # task rides' became 'the piece rides'). The plant removes `says` from that spread. Killed
        # by `what-the-cards-cannot-say-yet.test.ts`.
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
            (HOST, "        ...queued.authorship,\n        // 🔴 **671 · the piece rides the held message to the turn it becomes**", "        ...(({ says: _s, ...rest }) => rest)(queued.authorship),\n        // 🔴 **671 · the piece rides the held message to the turn it becomes**"),
        ],
    ),
    (
        "M18 · 🔴 the flushed turn carries no number · killed by `what-the-cards-cannot-say-yet.test.ts` §4",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The flushed
        # turn still takes the queued entry's piece and label (`queued.piece`, `queued.label`),
        # replacing `queued.taskNumber`. The plant keeps the piece and drops the label. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The flushed user_turn still takes the queued entry's piece and label,
        # but the line is now followed by the commit 6 drives spread instead of the closing brace
        # and return false. The plant keeps the piece and drops the label from the turn, so the
        # flushed turn carries no number. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
            (HOST, "          : { piece: queued.piece, label: queued.label }),\n        // ⚑ **D-016 · commit 6 · R4 — and what the held words drive**", "          : { piece: queued.piece }),\n        // ⚑ **D-016 · commit 6 · R4 — and what the held words drive**"),
        ],
    ),
    (
        "M19 · 🔴 R22 undone on the SIGN-IN ending — a held task that can never go out comes back "
        "as the person's · killed by `a-task-row-that-lies-about-its-holder.test.ts` §1.1",
        [
            (
                HOST,
                "          ...queued.authorship,\n",
                "          ...(({ attribution: _w, ...subject }) => subject)(queued.authorship),\n",
            )
        ],
    ),
    (
        "M20 · 🔴 the launch sweep writes the ending BARE again — a crashed task, reply, notice or "
        "go-ahead rebuilt from it is the person's · killed by `what-the-cards-cannot-say-yet.test.ts` §5",
        [(STORE, "            ...authorshipStoredOn(held.payload),\n", "")],
    ),
    (
        "M21 · ⛔ the sweep's query stops returning the held row, so there is nothing to carry · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §5",
        [
            (
                STORE,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still hands the ending writer no payload of the held row, so whose words it was is not carried onto the ending
                "          payload: one.payload,\n",
                "          payload: '{}',\n",
            )
        ],
    ),
    (
        "M22 · 🔴 the COMPOSER is not told whose words are waiting · killed by `what-the-cards-cannot-say-yet.test.ts` §1",
        [
            (
                QUEUED,
                "    ...(queued.authorship.attribution === undefined\n"
                "      ? {}\n"
                "      : { attribution: queued.authorship.attribution }),\n",
                "",
            )
        ],
    ),
    (
        "M23 · ⛔ the composer is told EVERY waiting message is BroBot's, the person's own included · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §1's control",
        [
            (
                QUEUED,
                "    ...(queued.authorship.attribution === undefined\n"
                "      ? {}\n"
                "      : { attribution: queued.authorship.attribution }),\n",
                "    attribution: 'app_authored' as const,\n",
            )
        ],
    ),
    (
        "M24 · 🔴 the number's bound leaves the replay composition — a stored *Task #NaN* is drawn · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §6",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The number's
        # replay bound became `boundPieceNamed`, composed in `boundStoredEvent` where
        # `boundTaskNumber` was. The plant removes it from the composition, so a stored label the
        # app could not have written is drawn. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The stored-event bound still needs boundPieceNamed innermost so a
        # piece's label and title are bounded on the stored row; the composition now also includes
        # boundTheDrive and sits inside boundStoredPayloads. The plant drops boundPieceNamed from
        # the composition. Killed by `what-the-cards-cannot-say-yet.test.ts`.
        [
            (STORE, 'boundRelayedIdentity(boundTheDrive(boundPieceNamed(event)))', 'boundRelayedIdentity(boundTheDrive(event))'),
        ],
    ),
    (
        "M25 · ⛔ the bound admits ANY number — zero, negatives and fractions are drawn as a task · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §6",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'Any number'
        # is now 'any string' in place of `Number.isSafeInteger && > 0`: the label check is
        # `pieceNumbersOf(event.label) !== null`, which rejects W0.7, W1.-3 and W1.07. The plant
        # drops that reader and keeps only the string type test. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (STORE, "  const aLabel = aPiece && typeof event.label === 'string' && pieceNumbersOf(event.label) !== null\n", "  const aLabel = aPiece && typeof event.label === 'string'\n"),
        ],
    ),
    (
        "M26 · ⛔ the bound keeps a number whose task id is gone — *Task #N* with nothing to join on · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §6",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'A number
        # whose task id is gone' is now 'a label beside a piece id that is not a storable id'
        # (`isAStoredId`), and the bound drops the label with the piece. The plant lets a readable
        # label survive whether or not its piece is a stored id. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (STORE, '  if (aPiece && (event.label === undefined || aLabel)) return event\n', "  if (event.label === undefined ? aPiece : typeof event.label === 'string' && pieceNumbersOf(event.label) !== null) return event\n"),
        ],
    ),
    (
        "M27 · ⛔ the CANCELLED ending stamps every message BroBot's, the person's own taken-back "
        "words included · killed by `what-the-cards-cannot-say-yet.test.ts` §1's control",
        [
            (
                HOST,
                "      // and a cancelled go-ahead — whose authorship IS `attribution` — rebuilt as the person's.\n"
                "      ...queued.authorship,\n",
                "      // and a cancelled go-ahead — whose authorship IS `attribution` — rebuilt as the person's.\n"
                "      ...queued.authorship,\n"
                "      attribution: 'app_authored' as const,\n",
            )
        ],
    ),
    (
        "M28 · ⛔ the CLOSE's ending stamps every message BroBot's · killed by `what-the-cards-cannot-say-yet.test.ts` §1's control",
        [
            (
                HOST,
                "        ...queued.authorship,\n      })\n    }\n",
                "        ...queued.authorship,\n        attribution: 'app_authored' as const,\n      })\n    }\n",
            )
        ],
    ),
    (
        "M29 · ⛔ the vanished-file ending stamps every message BroBot's · killed by `what-the-cards-cannot-say-yet.test.ts` §1's control",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The vanished-file ending moved into readyToGo (D-027) and ends with `return null`
        # instead of `return true`; the writer is otherwise identical and still spreads
        # `queued.authorship` whole (R22). The plant stamps every vanished-file ending app_authored,
        # which the control (a person's own held message in the same ledger) must refuse. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '        ...queued.authorship,\n      })\n      this.publishStateIfChanged(session)\n      return null\n', "        ...queued.authorship,\n        attribution: 'app_authored' as const,\n      })\n      this.publishStateIfChanged(session)\n      return null\n"),
        ],
    ),
    (
        "M30 · ⛔ the launch sweep stamps every ending BroBot's · killed by `what-the-cards-cannot-say-yet.test.ts` §5's control",
        [
            (
                STORE,
                "            ...authorshipStoredOn(held.payload),\n",
                "            ...authorshipStoredOn(held.payload),\n            attribution: 'app_authored' as const,\n",
            )
        ],
    ),
    (
        "M31 · ⛔ the HELD row stamps every message BroBot's, the person's own queued words included · "
        "killed by `what-the-cards-cannot-say-yet.test.ts` §1's control",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — R22's rule (the
        # held/queued row must carry the entry's OWN authorship, never a forced 'app_authored') is
        # unchanged and the exact `...held.authorship,` spread the row targeted is still in
        # `queueMessage` (with matching '687'/'R22' inline comments). The row went dark only because
        # D-017 added a SECOND, near-identical `...held.authorship,` spread in a brand-new sibling
        # function (`holdForTheNextStart`), so the row's old bare `old` string now matches twice;
        # the fix is to widen the anchor with surrounding comment text unique to `queueMessage`'s
        # copy.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R22 (the held
        # row carries the entry's own authorship, never a forced 'app_authored') survives in
        # `queueMessage`. It needs the same widened anchor as M4 (the following comment line)
        # because `...held.authorship,` also appears in `holdForTheNextStart`. The plant forces
        # `attribution: 'app_authored'` after the spread. Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — R22
        # stands: the held message_queued row in queueMessage carries the entry's own authorship and
        # never a forced app_authored. The comment under `...held.authorship,` was reworded by
        # D-016c to `the piece a held brief gives or a held new brief names`, so the old two-line
        # anchor matches nothing; the same spread also occurs in holdForTheNextStart and the abandon
        # path, so the new comment line is what keeps the anchor unique (count 1). Killed by
        # `what-the-cards-cannot-say-yet.test.ts`.
        [
            (HOST, '      ...held.authorship,\n      // ⚑ **D-016 · the piece a held brief gives or a held new brief names**, on the row read\n', "      ...held.authorship,\n      attribution: 'app_authored' as const,\n      // ⚑ **D-016 · the piece a held brief gives or a held new brief names**, on the row read\n"),
        ],
    ),
]
