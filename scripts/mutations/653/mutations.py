"""653 · A woken conversation drawn as ended.

⚑ **`652` F1, repaired — and measured wider than `652` said.** An `attached` hand-over means
*"nothing was resumed here"*; the renderer took it as *"there is no previous life on this page"*
and applied no reopen correction. But the RUNNING life of an attached conversation can itself have
been a reopen — woken with no window (`652`) and then claimed, or reopened by a window whose store
is then rebuilt without a navigation (HMR) — and then the page ends the previous life with
`session: ended`. On Claude the new life says nothing until its first turn's `system/init`, so a
person was drawn a conversation that had ENDED; after a crash the page also still offered the dead
life's open card.

## 🔴 A · what the dispatch CHANGED

 1. **The host keeps where the running life began** — `HostedSession.liveFrom`, fixed at
    `register` from `startingOrdinal` when the registration continues a recording, `null` for a
    first life.
 2. **An `attached` hand-over carries it** — `ResumedSession.liveFrom`, an OPTIONAL key written only
    when it is a number, so a spawned or created conversation's hand-over is byte-for-byte what it
    was. `resumed` does not carry it: its page is read before the provider is asked and ends exactly
    where the life begins, which is the epoch the renderer already takes.
 3. **The renderer crosses the epoch INSIDE the replay** — after the previous life's ending, before
    anything the running life has said — and assigns `record.liveFrom` on every adoption, so every
    later re-fold crosses it too.

## ⛔ B · what has NO row, said rather than left out

⛔ **The first version of this section said a `>`-for-`>=` crossing needed no row, and it was
wrong** (found by this dispatch's own review). It claimed the woken life's first row was the
provider's `session: resumed` and that `markReopened` one row later left it alone. ⚑ **On Claude
the first row is `status: working`** — `beginTurn` publishes it before the handshake, and it lands
before the host's `user_turn` — and `markReopened` resets the status to `idle`, so a person taking
over mid-turn would be drawn an idle conversation for the whole first turn. The double that let the
section be written emitted the Fake's order instead of Claude's. `M9` is that row now.

⚠️ **`673` made TWO of this table's rows equivalent alone, measured.** The host now writes
`reopened` as the first row of every reopened life (`663` F1), synchronously after `register`, so
every page a claim hands over reaches the epoch and the row AT it draws nothing:

 - `M9`'s flip alone (`>` for `>=`) crosses one row late and still lands before Claude's
   `working` — a SURVIVOR against §1.7;
 - `M8`'s removal alone (no crossing at the end of a page that stops short) removes a branch no
   page reaches any more — a SURVIVOR against the whole file.

⚑ Two lines on one path now carry each rule, so each row also takes the replay's epoch one row
on, past the host's `reopened` — in the renderer, never by dropping the host's row: the runner
runs whole projects, and `673`'s fold tests would kill that whatever this table's drawing tests
saw (`673`'s review).
The renderer's two lines are kept, with the measurement beside them, because a seam row that ever
moves or goes makes them load-bearing again with nothing going red. §1.7's premise asks the
provider's rows only, so what kills `M9` is the drawing.

⚠️ **No row making the RESUME carry the seam too.** The renderer takes a resumed page's epoch from
where the page ends and never reads the field on `resumed`, so the mutant changes no state a person
sees. `a-woken-conversation-drawn-as-ended.test.ts` §1.6 pins its ABSENCE as a design fact — one
answer per question — but a row that only a design pin can kill is a claim about taste, not a guard.

⚠️ **No row on the claim's `catch`** (`if (record.meta === null) sessions.delete(sessionId)`). It
removes a record the failed claim itself made, and nothing reads a record with no `meta` except to
ask the host about it — so a row would change which question is asked of a conversation this window
does not hold, and no test can see that.

## 🔴 C · the killers

`apps/desktop/test/a-woken-conversation-drawn-as-ended.test.ts` for every row: §1.1 / §1.3 / §2.1
for the seam and the crossing, §1.5 for the byte-identity of a first life's hand-over, §1.7 for
where the crossing lands, §3.1 for the claim's hold on early events. ⚑ Each row was
verified RED by hand against that file, anchor count `== 1`, restored from saved bytes.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"

# ⚑ **673 · the replay's epoch taken one row on, past the host's `reopened`** — so the provider's
# first row sits AT the epoch, as it did before `673`: the world in which M8's end-of-page crossing
# and M9's `>=` carry the rule alone. ⚠️ Equivalent by itself (the row it steps over draws nothing),
# and measured so. ⛔ In the RENDERER, and never by dropping the host's row: the runner runs whole
# projects, and `673`'s fold tests would kill a row that dropped it whatever this table's drawing
# tests saw (found by `673`'s review). A filter of the row was tried first and left `M9` a survivor:
# it moves no ordinal, so `>` still crossed before `working`.
THE_EPOCH = "    let epoch = record.liveFrom\n"
THE_EPOCH_PAST_THE_SEAM_ROW = "    let epoch = record.liveFrom === null ? null : record.liveFrom + 1\n"


# ⚑ The claim's bracket, whole — M11 puts back the two lines it replaced.
BRACKET = "      // ⚠️ `holding`, not `record`: `resume`'s bracket is spelled with `record`, and a line-for-line\n      // copy would make three of `242`'s anchors on it match twice.\n      const holding = slot(sessionId)\n      holding.handover += 1\n      try {\n        const handed = await bridge.claim({ sessionId })\n        return adoptHandover(slot(handed.sessionId), handed)\n      } catch (error) {\n        // ⚠️ As `resume` does for a hand-over that did not happen: a record this call made up for\n        // a conversation it does not hold is not left behind to be asked about.\n        if (holding.meta === null) sessions.delete(sessionId)\n        throw error\n      } finally {\n        holding.handover -= 1\n        if (holding.handover === 0 && sessions.get(sessionId) === holding) foldHeldEvents(holding)\n      }\n"

MUTATIONS = [
    # ── the host knows where the running life began ────────────────────────────────────────────
    (
        "M1 · 🔴 the host forgets the seam · every registration answers `liveFrom: null`, so a woken "
        "conversation claimed before its first turn is drawn ENDED again — `652` F1 exactly",
        [
            (
                HOST,
                "      liveFrom: options.continuesARecording ? options.startingOrdinal : null,",
                "      liveFrom: null,",
            )
        ],
    ),
    (
        "M2 · ⛔ a reopen registers as a FIRST life · the one moment the host knows where the seam is "
        "says there is none, and a window whose store is rebuilt after it pressed Reopen is drawn "
        "a conversation that has ended",
        [(HOST, "      continuesARecording: true,", "      continuesARecording: false,")],
    ),
    (
        "M3 · ⛔ the claim and the re-attach hand over no seam · the host knows it and does not say, "
        "so the renderer folds the previous life's ending as the present and still offers a card "
        "the dead life left open",
        [(HOST, "      liveFrom: session.liveFrom,", "      liveFrom: null,")],
    ),
    (
        "M4 · ⚠️ a CREATE says it continues a recording · every spawned and every created "
        "conversation's hand-over grows a `liveFrom: 0` it never had — the byte-identity the brief "
        "asked for, broken on the population that has no previous life at all",
        # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
        [(HOST, "      continuesARecording: recorded,", "      continuesARecording: true,")],
    ),
    (
        "M5 · ⚠️ a first life's hand-over carries `liveFrom: null` · a key where there was none, so "
        "every spawned and every created hand-over changes its bytes for a fact it does not have",
        [
            (
                HOST,
                "      ...(options.liveFrom === null ? {} : { liveFrom: options.liveFrom }),",
                "      liveFrom: options.liveFrom as number,",
            )
        ],
    ),
    # ── the renderer crosses it ────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the renderer ignores the seam · `record.liveFrom` stays `null` on an attached "
        "hand-over, so the replay crosses no epoch and the woken conversation is drawn ended",
        [
            (
                STORE,
                "    record.liveFrom = handed.handover === 'attached' ? (handed.liveFrom ?? null) : null",
                "    record.liveFrom = null",
            )
        ],
    ),
    (
        "M7 · ⛔ the adoption corrects at the END of the page while the record still says the life "
        "began at the seam · the card the woken life is waiting on is settled on arrival and comes "
        "BACK at the first re-fold — the incremental fold and the re-fold disagreeing, which is "
        "what crossing inside the replay exists to prevent",
        [
            (
                STORE,
                "      if (epoch !== null && past.ordinal >= epoch) {",
                "      if (epoch !== null && false) {",
            )
        ],
    ),
    (
        "M8 · ⛔ a page that stops short of the epoch is never crossed · with the epoch past the host's "
        "`reopened` (673: either alone is invisible), a conversation claimed before its first turn — "
        "the whole page previous life — keeps the previous life's ending as the present",
        [
            (STORE, "    if (epoch !== null) markReopened(record.control)\n", ""),
            (STORE, THE_EPOCH, THE_EPOCH_PAST_THE_SEAM_ROW),
        ],
    ),
    (
        "M9 · 🔴 the crossing lands ONE ROW LATE · `>=` becomes `>` with the epoch past the host's "
        "`reopened` (673: either alone is invisible), so the woken life's first row — Claude's "
        "`status: working` — is folded before the correction, which resets it to idle: a person "
        "taking over mid-turn is drawn an idle conversation for the whole first turn",
        [
            (
                STORE,
                "      if (epoch !== null && past.ordinal >= epoch) {",
                "      if (epoch !== null && past.ordinal > epoch) {",
            ),
            (STORE, THE_EPOCH, THE_EPOCH_PAST_THE_SEAM_ROW),
        ],
    ),
    (
        "M10 · ⛔ a first life's missing seam reads as `undefined`, not `null` · `undefined !== null`, "
        "so the replay applies the reopen correction at the end of every page — a spawned "
        "conversation's live cards settled on take-over, and *opened before* drawn for one that never was",
        [
            (
                STORE,
                "    record.liveFrom = handed.handover === 'attached' ? (handed.liveFrom ?? null) : null",
                "    record.liveFrom = handed.handover === 'attached' ? (handed.liveFrom as number) : null",
            )
        ],
    ),
    (
        "M11 · 🔴 the claim loses `resume`'s hold on early events (242 §3) · a window that watched a "
        "conversation end and takes the woken one over folds its first events into the ended record "
        "that the adoption then clears, and the card raised in the gap is never drawn",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds in code:
        # `claim` in the renderer `session-store.ts` still carries the `holding.handover += 1` / `-=
        # 1` bracket (653, 242 section 3), but the old whole-bracket anchor no longer matches
        # because the `finally` now calls `settleHeld(holding)` instead of
        # `foldHeldEvents(holding)`. The plant is now two ASCII-only edits that remove the increment
        # and the decrement/settle, which is exactly the claim losing `resume`'s hold. Caveat:
        # D-017b made a recorded record push early events to `earlyEvents` and call `look 'again'`
        # instead of folding them into the ended page, so the kill may now show as a concurrent look
        # beating the claim (claim returns false) rather than as an undrawn card.
        [
            (STORE, '      holding.handover += 1\n      try {\n        const handed = await bridge.claim({ sessionId })\n', '      try {\n        const handed = await bridge.claim({ sessionId })\n'),
            (STORE, '        holding.handover -= 1\n        if (holding.handover === 0 && sessions.get(sessionId) === holding) settleHeld(holding)\n', ''),
        ],
    ),
]
