"""735 · reopen and send, in one act — `701` F-8.

⛔ **The defect**: a conversation the quit left open is started by its first send, and the window
took that as TWO acts — the person's Reopen, then the send — so a send refused after a good start
left the conversation RUNNING with the person's words handed back (PM ruling R34: *"its provider
starts when something is sent to it"*). ⚑ `RuntimeHost.startAndSend` is one main door: the words go
and it runs, or they do not and nothing it started is left running.

## ⚑ What a row here measures

 * ⚑ **M1–M7 are what is asked BEFORE anything starts** — the premise (it is still waiting), the
   words, what is attached, the premise asked again after the disk read (a Close, a start), and one
   first message at a time.
 * ⚑ **M8–M19 are the undo** — the refusal answered and not thrown, the start stopped, the stamp put
   back at the quit's own moment and BEFORE the stop (so a person's Close during the stop wins), only
   for the door's own start, never over another sender's turn or a running giver's work, a failed
   put-back answered, and a failed stop taking the stamp back.
 * ⚑ **M20–M26 are the answer** — `stillWaiting` and the sentence read off the outcome, the running
   conversation handed over, the launch word carried, a refused start answered, and the words
   actually sent on the good path.
 * ⚑ **M27–M30 are the wire** — the launch key through the dispatch and the schema (the pane's
   Cancel), the send's own rule by construction, and the quit's door.
 * ⚑ **M31–M33 are the store's put-back and its read.**

## ⛔ What this table cannot reach

 * ⚠️ **The undo's `mailbox` and `flushing` clauses** — a message held while the conversation reads
   `idle` exists only between a turn's end and its flush; the `status` clause (M15) is what a test
   can plant, and it covers every held message behind a running turn.
 * ⚠️ **The undo's `slot.session === null` clause** and **`stillHere`'s `slot === started`** — each is
   redundant with a neighbour in every shape a test can build (a different slot is caught by
   `slot !== started`, a different window by `ownerId`); the first narrows the type.
 * ⚠️ **`aRunningGiverHoldsWorkIn`'s `catch`** (a store that throws on `tasksOf` answers "do not undo")
   and **`stampedAt === null`'s type half** — no test breaks the store there.
 * ⚠️ **Removed, not listed**: the undo's own announcement after the stop (it survived as a row —
   the stop's ending already announces, after the slot is gone and with the stamp back) and the
   put-back's answer (a row it refuses is a failed provider, which the stop closes anyway).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

KILLER = "a-first-message-starts-it-in-one-act.test.ts"
PARENT = "a-restart-keeps-what-was-open.test.ts"
QUIT = "shutdown-door.test.ts"
WIRE = "send-refusals.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · the premise is not asked — a conversation that is running, or closed, is started and "
        f"sent to by the door for a FIRST message · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The FIRST premise check
        # (was `keptOpen(id)===null?null:store.find(id)`) is now `const row = waitsForThisMessage()
        # ? this.deps.store.recordedOne(sessionId) : null` inside `startAndSend` — same job (refuse
        # before reading anything for a conversation this door may not touch), same rule, new name
        # (`startable`/`aPersonsWindowMayTakeIt` replacing quit-only `keptOpen`).
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `startAndSend`'s premise
        # check survives verbatim, just renamed from `sessionId` to `at` (D-017 · R10's `const at =
        # this.theOneInItsPlace(sessionId)` replacement lookup runs first). The exact guard
        # `waitsForThisMessage() ? this.deps.store.recordedOne(at) : null` still gates the read, so
        # the row's 'premise not asked' defect re-plants identically at the new name.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The old premise ask (`waitsForThisMessage() ? recordedOne(at) : null`)
        # is gone. Its job of refusing a conversation this window may not touch before anything is
        # read now belongs to the FIRST `heldByAnotherWindow(at, sink)` ask in startAndSend, placed
        # after the NOTHING_TO_SEND check and before the cwd and disk read. The plant deletes only
        # that first ask, anchored on the unique NOTHING_TO_SEND return plus the closing brace above
        # it, because the ask's own text appears three times (the second is 735 M4, the third is
        # inside afterWhatArrivedFirst). The killer file exists today, and no other row plant
        [
            (HOST, "        return notSent('before-the-start', NOTHING_TO_SEND)\n      }\n      if (this.heldByAnotherWindow(at, sink)) return notSent('held-elsewhere', HELD_ELSEWHERE)\n", "        return notSent('before-the-start', NOTHING_TO_SEND)\n      }\n"),
        ],
    ),
    (
        "M2 · what is attached is asked only by the send, AFTER the start — a moved file starts a "
        f"provider for nothing · killed by `{KILLER}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: what
        # is attached is checked against the disk BEFORE the start, so a moved file starts no
        # provider. It is now `recheckHandedPaths(attachments, cwd)` inside `if (cwd !== null)`,
        # with cwd read from the slot or the ledger row instead of `row.cwd`. Deleting those two
        # lines makes the send refuse it after the start, so `refusedBy` reads `after-the-start`.
        [
            (HOST, "        const handed = await recheckHandedPaths(attachments, cwd)\n        if ('refusal' in handed) return notSent('before-the-start', handed.refusal)\n", ''),
        ],
    ),
    (
        f"M3 · no words and nothing attached is refused only after the start · killed by `{KILLER}`",
        [(HOST, "      if (!hasSomethingToSend(text, attachments.length)) {\n"
                "        return notSent('before-the-start', NOTHING_TO_SEND)\n      }\n", "")],
    ),
    (
        # ⚑ Landing D-017 (45a11477) · killer:
        # `a-race-seen-after-the-disk-read-refuses-without-queuing.test.ts` (the landing added it).
        # ⚑ Landing D-017 (5206d835) · killer:
        # `a-race-seen-after-the-disk-read-refuses-without-queuing.test.ts`.
        "M4 · the premise is not asked again after the disk read — a start another window makes "
        f"meanwhile is raced, and refused as a reopen · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Today's 'second ask' —
        # `if (!waitsForThisMessage()) return notSent(...)` right before `whenTheQuitClosed` is read
        # — is the surviving spot of the old combined ternary
        # (`keptOpen(id)===null?null:whenTheQuitClosed(id)`): it re-checks the premise after the
        # async disk read (`recheckHandedPaths`) and is what actually catches another window's
        # `resumeSession` landing during that read (it fires before the later, redundant re-ask
        # inside `afterWhatArrivedFirst` is ever reached).
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The 'Step 2's second ask'
        # block is unchanged down to its comment text; only `sessionId` was renamed to `at`
        # throughout. Deleting the `if (!waitsForThisMessage())` re-check between the disk read and
        # `whenTheQuitClosed` re-plants the same 'a start another window makes meanwhile is raced'
        # defect.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and
        # its comment says '(735 M4)'. The disk read is followed by a second
        # `heldByAnotherWindow(at, sink)` ask, so another window's start is refused on its own,
        # never queued behind the arrivals. The old premise ask is now that ask; the third ask
        # inside `afterWhatArrivedFirst` still refuses with the same word, so only the race test
        # catches the removal. The line appears three times, so the anchor includes the preceding
        # comment line to be unique.
        [
            (HOST, "      // conversation's arrivals already carry, only to be told the same thing when that finishes.\n      if (this.heldByAnotherWindow(at, sink)) return notSent('held-elsewhere', HELD_ELSEWHERE)\n", "      // conversation's arrivals already carry, only to be told the same thing when that finishes.\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** D-017 makes a person's Close a STOP,
        # not a disqualifier, for this exact door — the commit's own new test asserts the opposite
        # of the old defect: 'a person's Close that lands while the attachment is read is seen — and
        # it is still one a message starts' (line 689) expects `'sent' in answer` to be `true`, with
        # the comment 'a Close is a STOP, not an ending: the door's second ask sees it, and it is
        # still a conversation a message starts, so the words go.' Sending despite a mid-read Close
        # is now the intended behaviour, so the row's premise no longer describes a bug. Its anchor
        # is left stale, so the census records it retired.
        "M5 · a Close that lands during the disk read is not seen — the door reopens and SENDS to a "
        f"conversation the person just closed · killed by `{KILLER}`",
        [(HOST, "      if (stampedAt === null) return notSent('no-longer-waiting', NO_LONGER_WAITING_TO_START)\n", "")],
    ),
    (
        "M6 · two first messages at once — the second is told the conversation is no longer waiting, "
        f"about the pane's own start · killed by `{KILLER}`",
        [(HOST, "    if (this.firstMessagesInFlight.has(sessionId)) {\n"
                "      return notSent('already-starting', A_FIRST_MESSAGE_IS_STARTING_IT)\n    }\n", "")],
    ),
    (
        "M7 · a first message that finished is still counted as starting it — the next one is refused "
        f"for ever · killed by `{KILLER}`",
        [(HOST, "      this.firstMessagesInFlight.delete(sessionId)\n", "")],
    ),
    (
        "M8 · a refusal after the start is thrown, not answered — the window gets a sentence and no "
        f"word, and the start is left running · killed by `{KILLER}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # refusal after the start is answered as `after-the-start`, never thrown. The undo call is
        # now `await this.undoAStartNoMessageReached(sessionId, started)` with no `stampedAt`,
        # inside `if (resumed.handover !== 'attached')`. Replacing it with `throw error` makes the
        # door reject and leaves the start running, as the label says, for every start the door
        # itself made.
        [
            (HOST, '        await this.undoAStartNoMessageReached(sessionId, started)\n', '        throw error\n'),
        ],
    ),
    (
        "M9 · the start is not undone — a send refused after it leaves the conversation RUNNING with "
        f"no message in it: `701` F-8 itself · killed by `{KILLER}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # send refused after the door's own start must stop that start, or 701 F-8 returns (the
        # conversation is left RUNNING with no message in it). Only the call's arguments changed
        # (`stampedAt` is gone). Deleting it leaves an empty `if` block, which is valid.
        [
            (HOST, '        await this.undoAStartNoMessageReached(sessionId, started)\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The commit removed the quit's stamp
        # put-back (`theQuitsStampPutBack`, `whenTheQuitClosed`, `forgetTheQuit`) and the 'Closed
        # conversations' list it protected ('no open / closed / kept-open split'). The undo now only
        # stops the start; nothing is stamped or moved between lists, so the defect has no subject.
        # Its anchor is left stale, so the census records it retired.
        "M10 · the start is stopped and the stamp is not put back — the conversation the person was "
        f"about to speak to is moved under Closed conversations · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired —
        # `undoAStartNoMessageReached` still puts the quit's stamp back so a Close during the stop
        # is undone correctly; the call is now `if (stampedAt !== null)
        # this.deps.store.theQuitsStampPutBack(sessionId, stampedAt)` (guard inlined) rather than a
        # bare statement, but dropping it plants the same 'moved under Closed conversations' defect.
        [
            (HOST, '      if (stampedAt !== null) this.deps.store.theQuitsStampPutBack(sessionId, stampedAt)\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** It plants a wrong moment into
        # `theQuitsStampPutBack`, which D-017b deleted from the host and the store along with the
        # stamp read, since there is no per-row kept-open fact. The test file's own note says
        # 'nothing puts a stamp back, because nothing reads one per row'. Its anchor is left stale,
        # so the census records it retired.
        "M11 · the stamp is put back at NOW, not at the quit's own moment — it loses its place among "
        f"what that quit left open · killed by `{KILLER}`",
        [(HOST, "theQuitsStampPutBack(sessionId, stampedAt)", "theQuitsStampPutBack(sessionId, this.now())")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The order 'put the stamp back BEFORE
        # the stop so a Close during the stop wins' no longer exists, because there is no stamp to
        # put back. What survives is a Close under way not being undone a second time (M13's
        # `onItsWayOut` clause), and the test now pins that as 'nothing is handed over, and nothing
        # runs it'. Its anchor is left stale, so the census records it retired.
        "M12 · the stamp is put back AFTER the stop (the order before `735`'s review) — a person's "
        f"Close during the stop is undone, and the conversation they closed comes back open · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Today's code already has
        # the corrected order the row protects — the stamp goes back in its own try block BEFORE the
        # separate `await this.close(...)` try block (matching the docstring 'the quit's stamp goes
        # back FIRST... and the Close comes after'). Reverting to the pre-735 order (put it back
        # only after close) reproduces exactly the row's defect: a Close landing during the stop is
        # undone.
        [
            (HOST, '      if (stampedAt !== null) this.deps.store.theQuitsStampPutBack(sessionId, stampedAt)\n', ''),
            (HOST, '      await this.close(sessionId, THE_APP_ITSELF)\n    } catch (error) {\n', '      await this.close(sessionId, THE_APP_ITSELF)\n      this.deps.store.theQuitsStampPutBack(sessionId, stampedAt)\n    } catch (error) {\n'),
        ],
    ),
    (
        "M13 · a Close already under way is undone as if it were the door's own start — a person's "
        f"Close comes back open · killed by `{KILLER}`",
        [(HOST, "    if (slot === undefined || slot !== started || slot.session === null || onItsWayOut(slot)) return\n",
          "    if (slot === undefined || slot !== started || slot.session === null) return\n")],
    ),
    (
        "M14 · a conversation that changed hands is undone — another window's conversation is "
        f"stopped · killed by `{KILLER}`",
        [(HOST, "    if (slot === undefined || slot !== started || slot.session === null || onItsWayOut(slot)) return\n",
          "    if (slot === undefined || slot.session === null || onItsWayOut(slot)) return\n")],
    ),
    (
        "M15 · another sender's turn is cut — the undo stops a conversation whose turn is running for "
        f"someone else · killed by `{KILLER}`",
        # ⚑ **parallel-workers · re-anchored in place, not retired** — Parallel-worker selection moves or repeats this text. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
        [(HOST, "    const session = slot.session\n    if (\n      session.handle.status() !== 'idle' ||\n      session.mailbox.length > 0 ||\n      session.flushing !== null\n", "    const session = slot.session\n    if (\n      session.mailbox.length > 0 ||\n      session.flushing !== null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The plant sits on aRunningGiverHoldsWorkIn in the start-undo path, which is deleted:
        # undoAStartNoMessageReached no longer consults it because a start tells nobody anything.
        # Commit 8d54d6dc: "its giver is told once, when it stalls. A stop, a reopen and a start
        # tell nobody anything and announce no work" and "Gone with it: ... the unwind of an
        # ending". The 735 tests in a-restart-keeps-what-was-open.test.ts were re-aimed to 'the
        # start is undone regardless of the giver'. Its anchor is left stale, so the census records
        # it retired.
        "M16 · a running giver's work is not asked — its child is stopped, and the giver, told the "
        f"start, is pushed *has ended* about a conversation that is open again · killed by `{PARENT}`",
        [(HOST, "      this.aRunningGiverHoldsWorkIn(sessionId)\n", "      false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Same subject as M16: the giver-holds-the-work exception (aRunningGiverHoldsWorkIn) in the
        # start-undo was removed on purpose, so undoing a start is now uniform. Commit 8d54d6dc: "A
        # stop, a reopen and a start tell nobody anything and announce no work" and "Gone with it:
        # ... the unwind of an ending". There is no guard left to weaken. Its anchor is left stale,
        # so the census records it retired.
        "M17 · a giver that is NOT running counts as one — the undo is refused wherever work was given, "
        f"and a child whose lead is closed is left running · killed by `{PARENT}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a restart keeps what was open, and that a lead not running has its start undone and reads
        # the true word, survives in the same open-piece filter with its `phase === 'live'` guard.
        # The plant drops the live-lead guard, so a piece open under a lead that is NOT running
        # counts as held work. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, "        .some((piece) => TASK_IS_OPEN[piece.state] && this.slots.get(piece.giver)?.phase === 'live')\n", '        .some((piece) => TASK_IS_OPEN[piece.state])\n'),
        ],
    ),
    (
        "M18 · a put-back that fails is thrown — the window gets a rejection and no conversation to "
        f"adopt · killed by `{KILLER}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — M18's rule (a failing undo step is answered, not thrown) survives
        # D-017b: the quit-stamp put-back is gone, and the undo's one step that can still fail is
        # the stop in undoAStartNoMessageReached, which console.warns and returns. The plant
        # rethrows there, so the person's refusal becomes an exception and the running conversation
        # is never handed over, as the old plant did with the put-back. The `old` text is the warn's
        # tail and occurs exactly once. The plant needs no signature change, so there is no syntax
        # error, TypeError or ReferenceError. Correct the row's label wording in a `#` comment on
        # the r
        [
            (HOST, 'started for a message that was refused: ${errorMessage(\n          error,\n        )}`,\n      )\n', 'started for a message that was refused: ${errorMessage(\n          error,\n        )}`,\n      )\n      throw error\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `store.forgetTheQuit` no longer exists
        # in the host or the store; the commit removed it with the rest of the kept-open fact ('no
        # keptOpenAcrossAQuit, no stillWaiting, no put-back'). A failed stop keeping a stamp has no
        # meaning without a per-row stamp. Its anchor is left stale, so the census records it
        # retired.
        "M19 · a stop that fails keeps the stamp — a conversation still running reads as one the quit "
        f"holds open · killed by `{KILLER}`",
        [(HOST, "      this.deps.store.forgetTheQuit(sessionId)\n    }\n", "    }\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `stillWaiting` is no longer a field of
        # the answer, and `aQuitLeftItOpen` is gone. The test docblock says 'no keptOpenAcrossAQuit,
        # no stillWaiting'. D-017b removed every per-conversation 'waiting / kept open' fact ('No
        # sentence says whether a process runs'). What the window is told now is `running` (M22's
        # row). Its anchor is left stale, so the census records it retired.
        "M20 · `stillWaiting` is read off the row taken, not off the conversation — a provider that no "
        f"longer has it is called waiting · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `stillWaiting` must be a
        # live read of the conversation (today: `this.aQuitLeftItOpen(sessionId)`, the successor of
        # the old `keptOpen(id)!==null` read) and not derived from the refusal's own discriminant;
        # deriving it from `refusedBy` plants the same 'a provider that no longer has it is called
        # waiting' defect.
        [
            (HOST, '          stillWaiting: this.aQuitLeftItOpen(sessionId),\n', "          stillWaiting: refusedBy !== 'no-longer-waiting',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'undone' clause is gone on
        # purpose. The refusal is now 'the send's own words, and nothing about a process (`05` rule
        # 5)', and the tests assert `said` does not match /running|stopped|started/i. Forcing a
        # claim that the start was undone would plant a sentence D-017b forbids, not a defect to
        # catch. Its anchor is left stale, so the census records it retired.
        f"M21 · the sentence says the start was undone whatever became of it · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `undone` is still
        # computed from a live rail read (`!took && this.aQuitLeftItOpen(sessionId)`, successor of
        # `keptOpen(id)!==null`); forcing it `true` unconditionally makes the sentence claim the
        # start was undone even when it was not (e.g. a provider failure, where the quit's stamp is
        # deliberately NOT put back).
        [
            (HOST, '      const undone = !took && this.aQuitLeftItOpen(sessionId)\n', '      const undone = true\n'),
        ],
    ),
    (
        "M22 · a start left running is never handed over — the window holds a conversation it cannot "
        f"draw · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The handover expression
        # `{ running: stillHere ? resumed : null }` is unchanged in shape from the row's target;
        # forcing `running: null` unconditionally plants exactly 'a start left running is never
        # handed over'.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # start that could not be undone is handed over as `running`, so the window can adopt it.
        # The expression now sits on its own line inside `notSent`'s third-argument object:
        # `running: stillHere ? resumed : null,`. Forcing `running: null` plants the same defect.
        # ⚑ Re-anchored in place, not retired — the hand-over is now the conversation as the refusal
        # left it (`{ ...resumed, liveness: livenessFor(running) }`); forcing `running: null` still
        # plants the same defect.
        [
            (
                HOST,
                '        running: running === null ? null : { ...resumed, liveness: livenessFor(running) },\n',
                '        running: null,\n',
            ),
        ],
    ),
    (
        f"M23 · a refused start's word is dropped — a Cancel reads as a failure · killed by `{KILLER}`",
        [(HOST, "          launch: whyALaunchWasRefused(error),\n", "          launch: null,\n")],
    ),
    (
        "M24 · a refused start is thrown, not answered — the window cannot tell whether it is still "
        f"waiting · killed by `{KILLER}`",
        [(HOST, "        return notSent('the-start', errorMessage(error), error, {\n",
          "        throw error\n        return notSent('the-start', errorMessage(error), error, {\n")],
    ),
    (
        "M25 · the good path starts it and never sends the words — a start with no message, the "
        f"defect's other face · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The good path's send call
        # (now `sendAs`, not `send`, per this commit's own arrivals-ordering fix) is still the one
        # place the words actually go out; dropping it plants the same 'starts it and never sends
        # the words' defect.
        [
            (HOST, "      await this.sendAs(sessionId, text, sink, attachments, {\n        facts: {},\n        ifItLosesTheRace: 'hold-it',\n      })\n", ''),
        ],
    ),
    (
        "M26 · a refusal with no full stop runs straight into what became of the start · "
        f"killed by `{KILLER}`",
        [(HOST, "  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`\n", "  return trimmed\n")],
    ),
    (
        "M27 · the window's door drops the launch key — the pane's Cancel finds no launch to stop · "
        f"killed by `{KILLER}`",
        [(IPC, "        command.launchKey ?? null,\n      )\n", "        null,\n      )\n")],
    ),
    (
        f"M28 · the wire STRIPS the launch key — `102`'s dead Cancel, on the new verb · killed by `{KILLER}`",
        [(IPC, "  sendShaped('startAndSend').safeExtend({ launchKey: launchKey.optional() }),\n",
          "  sendShaped('startAndSend'),\n")],
    ),
    (
        "M29 · the verb takes its own shape, not the send's — blank words pass the wire · "
        f"killed by `{KILLER}` and `{WIRE}`",
        [(IPC, "  sendShaped('startAndSend').safeExtend({ launchKey: launchKey.optional() }),\n",
          "  z.object({ kind: z.literal('startAndSend'), sessionId, text: z.string(), attachments, "
          "launchKey: launchKey.optional() }),\n")],
    ),
    (
        "M30 · the quit's door answers it — a start during a quit, and a ledger read after it closed · "
        f"killed by `{QUIT}`",
        [(IPC, "  startAndSend: 'refused',\n", "  startAndSend: 'answered',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `putBackClosedByTheQuit` (the `... AND
        # closed_by_the_quit_at IS NULL AND status <> 'errored'` statement) was deleted from the
        # store, together with `theQuitsStampPutBack`. Nothing puts a stamp back any more, so a
        # put-back that stamps a failed provider's row cannot happen. Its anchor is left stale, so
        # the census records it retired.
        f"M31 · the store stamps a row whose provider FAILED (R34a) · killed by `{KILLER}`",
        [(STORE, "      WHERE id = ? AND closed_by_the_quit_at IS NULL AND status <> 'errored'`,\n",
          "      WHERE id = ? AND closed_by_the_quit_at IS NULL`,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** It shares M31's deleted
        # `putBackClosedByTheQuit` statement. The commit removed the put-back door, so writing over
        # a stamp already there has no subject. Its anchor is left stale, so the census records it
        # retired.
        f"M32 · the store writes over a stamp already there · killed by `{KILLER}`",
        [(STORE, "      WHERE id = ? AND closed_by_the_quit_at IS NULL AND status <> 'errored'`,\n",
          "      WHERE id = ? AND status <> 'errored'`,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The read that returned `row?.at ??
        # null` was `whenTheQuitClosed` (`selectWhenTheQuitClosed`), which the commit deleted with
        # the put-back. Nothing in `startAndSend` reads the quit's moment any more. Its anchor is
        # left stale, so the census records it retired.
        "M33 · the stamp's moment is not read — a put-back has nothing to write, and the conversation "
        f"the person was about to speak to is closed · killed by `{KILLER}`",
        [(STORE, "      return row?.at ?? null\n", "      return null\n")],
    ),
]
