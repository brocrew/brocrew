"""657 · Hold the second message instead of refusing it.

⛔ **Dispatched from `650`'s own findings.** `650` gave a race an honest word — a message that
read its receiver idle and lost the handover to another sender's turn answered
`agent-started-a-turn-first`. ⚑ `657` holds it instead, and settles four smaller findings beside it.

## 🔴 A · what the dispatch CHANGED

⚑ **F6 · the hold** (`RuntimeHost.queueAs`). A lost race goes back through every gate as a
second attempt that never takes the idle branch, and is held — or refused by the rail that is true
then. ⚠️ **Every message now waits, bounded, for work already on its way to the same conversation**
before it decides: a work handover not yet written down as a task, or a flush still handing over.
That closes the two-open-tasks hole for ordinary holds too, not only for the loser. ⚑ A held message
re-checks that its conversation is not closing right before the push, and flushes at once if the
conversation is already free. The word `agent-started-a-turn-first` is RETIRED.

⚑ **F2 · a launch that did not start.** `spawn_agent` classifies the typed launch failures it knows
into two `TOOL_REFUSALS` words — `agent-did-not-start` (a person's to change) and
`agent-took-too-long-to-start` (retryable) — with a closed reason in `detail`, and rethrows the
rest. The host keeps the translated error's class as `cause`.

⚑ **F5 · no identity read after the handover** — `send` builds its `user_turn` row first, the
receipt takes the recipient's profile from its caller, the held row spreads the entry's authorship.

⚑ **F4 · `withdraw_task` answers a launch in flight with the shared word**, and **F7 · the
interrupt door's sentence** says both ways that wait can end.

## ⛔ B · the rows this dispatch corrected, retired or re-aimed elsewhere

⚑ **Corrected in place and re-verified RED by hand**: `216 M10` (the `user_turn` literal is a
`const` now), `406 M5` and `413 M12` (the held row spreads the entry's authorship), `439 M12` (the
receipt takes `toProfile`). ⚑ **`650 M9` re-aimed**: its rule — a lost race must not be folded into
the catch-all — is the hold's, so it now removes the hold. ⛔ **`650 M16` RETIRED by name**: its
subject, the retired word's permanence entry, no longer exists; the successor for *the lost race is
priced as a person's* is `650 M9` alone, the one row that sends the loser into the catch-all's price
again. This table's `M4`/`M5` guard the hold's own failures and never produce a price.

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row on the loser releasing its own announcement early** (`onItsWay?.arrived()` in the
catch). ⚑ The `finally` releases it too, and it runs before the second attempt can reach its wait —
that attempt awaits its sign-in check first — so removing the early release changes nothing today:
the row was written, applied, and SURVIVED for exactly that reason. ⚠️ The line stays as the form
that does not depend on that ordering; a mutation that changes nothing is not a measurement
(`a-mutation-that-changes-nothing-reports-as-a-survivor`).

⛔ **No row on the census files** it re-aimed (`a-refusal-carries-its-remedy`,
`what-an-agent-is-told-about-its-work`, `a-reach-you-can-see`), for `650`'s reason: weakening a
census passes the census. ⛔ **No row on prose** — the docblock corrections are measured by the
behaviour they now describe.
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
INTERRUPT = "apps/desktop/src/main/runtime/interrupt-rails.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · F6 · the hold ──────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a message decides without waiting for work already on its way** · the second of "
        "two work messages reads the conversation idle while the first is between its handover and "
        "its task row, races, and — held on a second attempt against *no open work* — becomes a "
        "second open task beside the first, which is the state HO-021 §1 property 3 forbids",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The bounded wait for a give to reach a busy conversation still exists
        # in the give path. D-022 added a second copy of the loop in whereTheGiveItRidesStands, so
        # the old 4-space anchor now also matches inside the 6-space copy; the leading newline makes
        # it match once. The plant makes the loop never run, so the giver is told 'held' at once
        # instead of after the wait. Killed by `hold-the-second-message.test.ts`.
        [
            (HOST, '\n    while (this.somethingIsOnItsWayTo(session) && Date.now() < giveUpAt) {\n', '\n    while (false as boolean) {\n'),
        ],
    ),
    (
        "M2 · ⛔ **the wait has no bound that anyone would meet** · a handover that never ends holds "
        "every message behind it — the tool call hangs, which a model reads as a broken agent "
        "(standing rule 13)",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The give's wait is still capped by this.deliveryWaitMs, but D-022
        # added a second copy of the giveUpAt line in whereTheGiveItRidesStands, so the bare anchor
        # matches twice; the leading newline (4-space indent) selects the original. The plant
        # replaces the bound with an hour, so a give waits far past the bound the test sets. Killed
        # by `hold-the-second-message.test.ts`.
        [
            (HOST, '\n    const giveUpAt = Date.now() + this.deliveryWaitMs\n', '\n    const giveUpAt = Date.now() + 3_600_000\n'),
        ],
    ),
    (
        "M3 · 🔴 **work on its way is never announced** · nothing is waited for because nothing "
        "says it is coming — `M1`'s outcome arriving from the other side of the wait",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a second message to an agent whose first piece is still on its way must WAIT for
        # that piece, not race it. In queueAs the wait comes from workSetsOffTo(session) when a
        # piece is being given. The plant makes onItsWay always null, so the second message does not
        # hold. Killed by `hold-the-second-message.test.ts`.
        [
            (HOST, '      const onItsWay = giving === null ? null : this.workSetsOffTo(session)\n', '      const onItsWay = null as { arrived: () => void } | null\n'),
        ],
    ),
    (
        "M4 · ⛔ **a second attempt may take the idle branch again** · a loser whose winner finished "
        "during the wait sends instead of holding, and can lose again — a recursion with no bound, "
        "which the forced hold exists to remove",
        [
            (
                HOST,
                # ⚑ **Anchor corrected by `670`, not retired**: the read also asks whether a person's
                # interrupt-and-send holds the queue now, so it wraps. Same defect — the mode check goes.
                # ⚑ **RE-ANCHORED at `698`, not retired**: the read moved into
                # `itTakesAMessageStraightIn`, which `queueAs` and the wake both ask (`690` F-1), and
                # is its one-line `return`. The mode check still goes.
                "    return mode === 'as-it-finds-it' && session.handle.status() === 'idle' && !session.holdingQueue\n",
                "    return session.handle.status() === 'idle' && !session.holdingQueue\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **a hold made on a free conversation is never sent** · the `idle` event that flushes "
        "a mailbox has already passed, so the words sit held with nothing left to send them — the "
        "*held message that can never go out* shape `648` repaired, arriving by a new road · killed by `hold-the-second-message.test.ts` (named by W4.78)",
        [
            (
                HOST,
                # ⚑ **W4.78 · re-anchored in place, not retired** — e0e93e6e made the flush the `else` arm of `if (itsSignInMovedOn) this.reopenForWhatWaits(session)`. Dropping that line leaves the if alone, so a hold on a free conversation is never sent. Killed by §1.2 (a second attempt that finds the conversation free again still holds, and goes out at once).
                "    else this.flushQueued(session)\n    return { outcome: 'queued', messageId: id }\n",
                "    return { outcome: 'queued', messageId: id }\n",
            )
        ],
    ),
    (
        "M6 · ⛔ **a message is held in a conversation that is closing** · the gate ran before two "
        "awaits, and a push after the teardown ended every held message gets no ending at all — "
        "the caller is told *held* about words nothing will ever send",
        # ⚑ **RE-ANCHORED at 690, not retired**: `whatAMessageWouldMeet` asks the same guard one
        # indent deeper, so the bare line matched twice; the next line pins this one.
        [
            (
                HOST,
                "    this.assertAcceptsMessages(session, 'queue')\n    const id = newQueuedMessageId()\n",
                "    const id = newQueuedMessageId()\n",
            )
        ],
    ),
    # ── B · F5 · no read after the handover ────────────────────────────────────────────────────
    (
        "M7 · 🔴 **the turn row re-reads the caller after the words have left** · a read that fails "
        "there reaches `message_agent` as *the message was not queued* while the provider is "
        "answering it",
        [
                # ⚑ **Anchor corrected by `670`, not retired**: the interrupt-and-send builds its row
                # before the handover too now (`657` F-e), so the bare line occurs twice. The
                # anchor takes the line above it, which only `send`'s body has.
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    // saying "from your next message" and start saying what the session is now doing.\n    this.publishStateIfChanged(session)\n    this.publishOurs(session, turn, undefined, moveHandoff, personalHandover)\n', '    // saying "from your next message" and start saying what the session is now doing.\n    this.publishStateIfChanged(session)\n    this.publishOurs(session, { ...turn, ...whoseWordsTheseAre(by, this.profileOf, facts) }, undefined, moveHandoff, personalHandover)\n'),
        ],
    ),
    (
        "M8 · ⛔ **the receipt reads the recipient after the words have left** · the same false "
        "*not queued*, from the sender's receipt",
        [
            (
                HOST,
                "      toProfile,\n      kind,\n      delivery,\n",
                "      toProfile: this.deps.store.identityOf(target.id)?.profileSlug ?? null,\n"
                "      kind,\n      delivery,\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ **the held row re-reads the caller after the push** · the words are in the mailbox "
        "and will be sent, and a read that fails here tells the caller they were not queued — a "
        "retry sends them twice",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 687: `heldAuthorship` is gone (R22) and the held row spreads the entry's
                # authorship whole. The defect — the row re-reading the caller after the push — is
                # unchanged, and now carries the declaration the entry does.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same disambiguation issue
        # as 624:M3: this commit's new `holdForTheNextStart` duplicated the literal
        # `...held.authorship,` text, breaking the row's exactly-once anchor. The original subject
        # (queueAs's held row re-reading the caller's identity after the mailbox push) is untouched
        # and is exactly what hold-the-second-message.test.ts §5.2 was written to pin. Anchored with
        # the same disambiguating comment block as 624:M3, with M9's own replacement (a fresh
        # re-derivation instead of the stored value).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the message_queued row carries the held entry's own authorship (held.authorship)
        # and does not derive it a second time. The plant recomputes it with whoseWordsTheseAre, the
        # same call the held entry was built with, so only the second read differs. Anchored on the
        # 657 comment line because ...held.authorship, occurs at three sites. Killed by
        # `hold-the-second-message.test.ts`.
        [
            (HOST, "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...held.authorship,\n", "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...whoseWordsTheseAre(by, this.profileOf, facts, says ?? undefined),\n"),
        ],
    ),
    # ── C · F4 · F7 ────────────────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 **a launch in flight is an ended child again at `withdraw_task`** · the task is "
        "real and the identical call withdraws it a moment later, and the caller is told "
        "`no-task-you-gave-that-agent`, priced `permanent`",
                # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` F-1) gave the refusal the task's project; the row still answers a launch in flight as an ended child.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: a
        # withdraw_task on a launch in flight must be refused 'that-conversation-has-not-started',
        # not folded into 'no-task-you-gave-that-agent'. D-016a only dropped projectSlug from that
        # refusal, so the old anchor no longer matches; plant the same fold on the projectSlug-free
        # arm.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: taking back a piece whose brief is still on its way out is refused with
        # 'that-conversation-has-not-started', a clearing refusal that carries the piece and label.
        # It is not answered with the generic not-yours refusal. takeBackPiece still branches on
        # onItsWayOut(slot). The plant returns notYours on both branches. Killed by
        # `hold-the-second-message.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: withdrawing a piece whose owner's launch is in flight answers
        # that-conversation-has-not-started, not the not-yours word. The branch moved into
        # whereItsHolderStands as a because: ternary that takeBackPiece maps, so the old two-line
        # anchor stopped matching. The plant collapses both branches into out-of-its-reach, which
        # reads as not-a-piece-you-gave. Killed by `hold-the-second-message.test.ts`.
        [
            (HOST, "        because: onItsWayOut(slot) ? 'out-of-its-reach' : 'that-conversation-has-not-started',\n", "        because: 'out-of-its-reach',\n"),
        ],
    ),
    (
        "M11 · ⛔ **a reservation being closed is told to retry at `withdraw_task`** · it will never "
        "come up, and the shared word would promise a moment that is not coming",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a reservation being closed is not told to retry, since it will never come up.
        # It shares its anchor with M10, so apply each alone. The plant makes onItsWayOut(slot) read
        # false in that ternary, so a closing reservation is told that-conversation-has-not-started.
        # Killed by `hold-the-second-message.test.ts`.
        [
            (HOST, "        because: onItsWayOut(slot) ? 'out-of-its-reach' : 'that-conversation-has-not-started',\n", "        because: (false as boolean) ? 'out-of-its-reach' : 'that-conversation-has-not-started',\n"),
        ],
    ),
    (
        "M12 · ⚠️ **the interrupt door presupposes the launch succeeds** · *wait for it to be "
        "working* is false on the arm where the launch fails and the retry meets `no-such-agent`",
        [
            (
                INTERRUPT,
                "It comes up or fails to launch on its own: ask again in a moment.",
                "Wait for it to be working and ask again.",
            )
        ],
    ),
    # ── D · F2 · a launch that did not start ───────────────────────────────────────────────────
    (
        "M13 · 🔴 **`spawn_agent` is a pass-through again** · a failed launch reaches the model as a "
        "broken tool, with the host's raw text — the defect `650` F2 named",
        [
            (
                TOOLS,
                "        launchedOrSaid(args, async () => {\n",
                "        guarded(async () => {\n",
            )
        ],
    ),
    (
        "M14 · ⛔ **the classifier becomes a catch-all** · every failure of the spawn — a store that "
        "failed, an invariant that broke — is dressed as a launch that did not start, which is the "
        "fold `650` spent a dispatch undoing",
        [
            (
                TOOLS,
                "      if (failed === null) throw error\n",
                "      if (failed === null) return refusalAnswer(refuseTool('agent-did-not-start', {}))\n",
            )
        ],
    ),
    (
        "M15 · 🔴 **a launch that took too long is priced as a person's** · the same call is a fresh "
        "launch nobody has to act before, and the caller is told a person has to change something",
        [
            (
                TOOLS,
                "  if (reason === 'took-too-long') return { rail: 'agent-took-too-long-to-start', because: reason }\n",
                "  if (reason === 'took-too-long') return { rail: 'agent-did-not-start', because: reason }\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **the host drops the class when it translates** · the person's sentence survives "
        "and nothing below it can classify by type any more, so every translated launch failure "
        "propagates as a broken tool",
        [
            (
                HOST,
                "    return new Error(describeUnavailable(reason, unavailableContextOf(error)), { cause: error })\n",
                "    return new Error(describeUnavailable(reason, unavailableContextOf(error)))\n",
            )
        ],
    ),
    (
        "M17 · ⚠️ **a missing sign-in is not classified** · the one failure a person most needs to "
        "be named for reaches the model as a broken tool",
        [(TOOLS, "  if (error instanceof AuthUnavailableError) {\n", "  if (false as boolean) {\n")],
    ),
    (
        "M18 · 🔴 **the host's raw text reaches the model** · a Codex sign-in message carries a "
        "filesystem path and a missing binary an install instruction, and `detail` hands both to a "
        "shell-capable agent",
        [
            (
                TOOLS,
                "          because: failed.because,\n",
                "          because: failed.because,\n"
                "          said: error instanceof Error ? error.message : String(error),\n",
            )
        ],
    ),
    (
        "M19 · ⛔ **the timed-out launch is not retryable** · `retryable` is derived from this word, "
        "and the sentence says *nobody has to act* beside a field saying the opposite",
        [
            (
                TOOLS,
                "  'agent-took-too-long-to-start': 'while-this-holds',\n",
                "  'agent-took-too-long-to-start': 'until-a-person-changes-it',\n",
            )
        ],
    ),
    # ── E · the answer a held caller reads ─────────────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M20 · ⚠️ **the held answer promises a turn that may not be running** · a hold made after a "
        "lost race can find the winning turn already over, and then it goes at once; and a hold "
        "behind another held message waits for that one's turn too · killed by `hold-the-second-message.test.ts` (named by W4.78)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The hold sentence and its
        # defect are unchanged; D-017 (or an adjacent relay feature) only added `${where}` and
        # switched `${agent}` to `${wentTo ?? agent}` for a routed/relayed recipient. The same 'it
        # goes out as its own turn once X is free... at once, if nothing is' clause is still there
        # to revert to 'it will be delivered when the turn it is running now ends'.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The message_agent answer for a held message still says when it will
        # go out. D-022 reworded it to 'it goes out as its own turn once it is free and anything
        # held before it has gone — at once, if nothing is'. The plant puts back the older, false
        # claim that it is delivered when the running turn ends. Killed by
        # `hold-the-second-message.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The rule survives and D-027 reworded the held answer again: it now reads 'it goes out
        # once X is free — at once, if it is — with whatever else is held for it, oldest first (a
        # person's command goes on its own)', built from the shared WITH_WHATEVER_ELSE_IS_HELD
        # clause. The plant puts back the old false promise that a held message goes out when the
        # running turn ends. hold-the-second-message §1.1 was re-aimed by D-027 and asserts both the
        # new clause and that the old words are absent. Killed by `hold-the-second-message.test.ts`.
        [('apps/desktop/src/main/runtime/agent-tools.ts', '                `${where}held for ${called}; it goes out once ${again} is free — at once, ` +\n                  `if it is — ${WITH_WHATEVER_ELSE_IS_HELD}.`) +', "                `${where}held for ${called}; it will be delivered when the ` +\n                  'turn it is running now ends.') +")],
    ),
    # ── F · what the review of `657` found ────────────────────────────────────────────────────
    (
        "M21 · 🔴 **a parent that ended its own launch is told a person has to act** · nobody else was "
        "involved and the same call starts — the sentence was false on exactly the arm `657`'s own "
        "test runs",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same rule, one word
        # stale: D-017 renamed 'ended' to 'stopped' throughout (end_agent is gone), so the live
        # sentence now reads 'somebody stopped it first' where it used to read 'somebody ended it
        # first'. The adjoining comment in agent-tools.ts quotes this exact history ('D-017 — ended
        # went with end_agent... somebody stopped it first is true of both'), confirming the two-arm
        # honesty rule the row protects is unchanged.
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — PE-006 (3c0c4280)
        # rewrote `agent-did-not-start` to lead with 'ask a person to read the detail and decide...'
        # but kept the two-arm tail 'somebody stopped it first or a person must fix something', so
        # the old anchor is gone and the rule survives. a-launch-that-did-not-start.test.ts §2 (a
        # parent's launch stopped by a quit) still asserts the sentence contains 'somebody stopped
        # it first' and not 'has to change that first'. The plant swaps the tail for the first-draft
        # claim that only a person can change it. Killed by `a-launch-that-did-not-start.test.ts`,
        # `what-a-person-must-fix-said-once.test.ts`.
        [
            (TOOLS, "nothing was sent: somebody stopped it first or a person must fix something.',\n", "nothing was sent: a person has to change that first.',\n"),
        ],
    ),
    (
        "M22 · ⚠️ **the host's diagnostic is recorded nowhere** · the model gets a closed reason, and "
        "without the log line the precise text — a `config.toml` that would not parse, a path — that "
        "used to reach the transcript is gone",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: when give_work's launch did not start, the failure is logged with console.warn
        # naming the reason. The warn is still in the launch-did-not-start path of agent-tools.ts.
        # The plant turns it into a String() call that logs nothing. Killed by
        # `a-launch-that-did-not-start.test.ts`.
        [
            (TOOLS, '      console.warn(\n        `give_work: the launch did not start (${failed.because}): ${\n', '      String(\n        `give_work: the launch did not start (${failed.because}): ${\n'),
        ],
    ),
]
