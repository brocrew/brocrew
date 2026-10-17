#!/usr/bin/env python3
"""234's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **One queued message could be published as BOTH abandoned and sent.** `cancelQueuedMessage` has
carried a guard against exactly that since 077's review, with five lines of comment saying why;
`abandonQueued` did the same thing to the same field with none — and it is reached from
finalization, so the racing flush is the unattended one.

The rows fall into six groups:

  * `M1`-`M7`   **§1 · one ending, and only the holder may publish it.** `holdsQueued` is the whole
    rule, asked at every point `runFlush` resumes from a suspension. ⚑ **`M4` is the version of this
    fix that the adversarial pass over this dispatch's own diff rejected**: reading `session.flushing`
    instead of `handingOver`, which spans two suspensions BEFORE the handover and therefore attached
    *"it may have reached the agent"* to messages that provably never left.
  * `M8`-`M15`  **§2 · the busy selector, the closing card, and the paint.** `227` M4 / `228` M1 and
    `228` M2. `M15` is the one the review found: the sentence changed register and the colour did not.
  * `M16`-`M23` **§3 · the content rule the host did not own** (`228` L1) and the fourth wire verb
    (`228` M3), plus the censuses that make both visible.
  * `M24`-`M25` **§4 · `..` is a path segment, not a substring** (`227` LOW 1).
  * `M26`       **the instrument** — the live step that carries §2's gesture.
  * `M27`-`M43` ⛔ **seventeen OLDER rows, re-anchored and re-run here.** Every one moved because a
    LINE moved, not because a rule went: the turn gate took the content rule, so all six
    `assertCanTakeTurn` call sites now hand over their text and attachment count; `sendBlocked` gained
    a line; the busy selector became one predicate; `WIRE_REFUSALS` rows grew a `verbs` field; and the
    containment test became a segment comparison. `M27`↔149 M12, `M28`↔149 M13, `M29`↔149 M15,
    `M30`↔216 M5, `M31`↔216 M20, `M32`↔216 M21, `M33`↔216 M22, `M34`↔216 M24, `M35`↔219 M1,
    `M36`↔219 M5c, `M37`↔219 M7, `M38`↔221 M9, `M39`↔221 M10, `M40`↔232 M6, `M41`↔232 M9,
    `M42`↔232 M14, `M43`↔232 M24.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **TWO rows survived run 1 and both were coverage, not code** — `M2` (the check before the
    handover) and `M6` (the marker's `finally`). ⚠️ **`M6`'s LABEL was also wrong**, which is the
    `232` `M33` shape again: a row that could not express its own defect. Identity comparison makes a
    stale marker harmless against any *other* message, so the `finally` is load-bearing on exactly
    one path — a send that throws, which leaves the message queued with the marker still standing.
    Re-argued, both killed in isolation with the tree restored byte-identically, and the WHOLE table
    re-run.
  * ⛔ **`runFlush`'s FIRST ownership check (the one 232 added, after the path re-check) still has NO
    ROW.** 232 said the race could not be scheduled against `FakeRuntime`; this dispatch found that
    two of the three CAN be — the handover through a gate on `handle.send`'s resumption, the turn
    gate through a `checkSignIn` the fake does not otherwise have — and the first still cannot,
    because `recheckHandedPaths` is a module function with no seam to hold it at. ⚑ A row disarming
    that check would therefore SURVIVE, which is a certificate for itself (224 `M8`/`M33`'s lesson),
    so it is written down instead.
  * ⛔ **`227` LOW 1's Windows half.** `M25` kills on the exact-`..` case; the `isAbsolute(step)`
    branch answers for a target on a different root, which `relative()` can only produce on Windows.
    No row mutates it and no test on this platform could tell.
  * ⛔ **The live seam.** Every row below is killed by a unit test. That a real file dropped on a real
    composer, mid-turn, with an empty box, offers both send outcomes is `BROBOT_SMOKE_ONLY=1b,11h,47`
    and only that.
  * ⚠️ **`runtime` is in the run and no row mutates it.** No line of `packages/runtime` changed in
    this dispatch; a project that stays GREEN on every row is the honest way to say so, and the way
    collateral damage would show up if it existed.
"""

from pathlib import Path

HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
REFUSALS = "apps/desktop/src/renderer/src/lib/send-refusals.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

GATE_SEND = "await this.assertCanTakeTurn(session, 'send', {\n      text,\n      attached: attachments.length,\n      from: this.originOf(by),\n    })"

# (name, [(file, old, new), ...])
# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS = [
    # ---- §1 · one ending per queued message ------------------------------------------------------
    (
        "M1  · 🔴 THE DEFECT, verbatim (231, from 216's own out-of-scope note) · the flush publishes "
        "`sent` and `user_turn` over an `abandoned` teardown has already written for the same message",
                # ⚑ **Anchor corrected by `670`, not retired**: `runFlush` now answers whether it
                # ended its head without a turn, so this early return says `false`. Same defect.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 replaced the one-message `if (!this.holdsQueued(...)) { warn; return false }` with
        # `const went = sending.filter(holdsQueued)` followed by `if (alone === undefined) { warn;
        # return false }`. The rule (a teardown that already wrote `abandoned` must not be followed
        # by `sent` and `user_turn` for the same message) is intact. The plant makes `went` the
        # whole `sending` list, so the resumed flush publishes `sent` and `user_turn` over the
        # teardown's ending. Killed by `queued-message.test.ts`.
        [
            (HOST, '    const went = sending.filter(({ queued }) => this.holdsQueued(session, queued))\n', '    const went = sending\n'),
        ],
    ),
    (
        "M2  · ⛔ §1 · the check BEFORE the handover goes, so the provider is handed a message the "
        "ledger has already ended — a turn started on a session that is going away",
                # ⚑ **Anchor corrected by `670`**, for `M1`'s reason: the return now says `false`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 folded the check before the handover into `going = going.filter(holdsQueued)` plus
        # `if (going.length === 0) return true`, so the old one-line anchor no longer exists. The
        # rule survives: after the turn gate suspends, a message a Close handed on must not be
        # handed to the provider. The plant deletes both lines, so the resumed flush hands the
        # provider a message the stop already took. Killed by `queued-message.test.ts`.
        [
            (HOST, '      going = going.filter(({ queued }) => this.holdsQueued(session, queued))\n      if (going.length === 0) return true\n', ''),
        ],
    ),
    (
        "M3  · 🔴 §1 · the ownership predicate itself always says yes — every suspension point above "
        "keeps its call and none of them means anything",
        # ⚑ **Anchor corrected in place by `394`, not retired** (142's rule). That dispatch made
        # the slot a MAILBOX, so the ownership question is `includes` rather than `===`. ⛔ **The
        # DEFECT is unchanged**: the predicate stops asking and always says yes.
        [(HOST, "    return session.mailbox.includes(queued)", "    return true")],
    ),
    (
        "M4  · ⛔ §1 · ⚑ THE FIX THE REVIEW REJECTED, put back · `abandonQueued` reads `flushing` "
        "instead of `handingOver`, so a message still at the path re-check or the turn gate is "
        "described as one that may have reached the agent",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — abandonQueued was renamed
        # handOnWhatItHeld under D-017 R3 ('a stop hands what it held to the next start; only a cut
        # handover is abandoned'), but the exact sub-rule this row protects — identify the ONE
        # message truly mid-handover by identity (session.handingOver === queued, now named `cut`),
        # never by the wider `flushing` window — is preserved verbatim, including a doc comment on
        # HostedSession.handingOver that still narrates this exact rejected fix. Only the variable
        # name changed (handingOver → cut).
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — handOnWhatItHeld still decides per message with `const cut = ...`, but D-027 made
        # `handingOver` a list, so the compare is now `session.handingOver.includes(queued)`. The
        # rule (only a message truly mid-handover is ended with the doubt, never one still at the
        # path re-check or the turn gate) is unchanged. The plant reads `session.flushing !== null`,
        # which is true across the gate suspension too. Killed by `queued-message.test.ts`.
        [
            (HOST, '      const cut = session.handingOver.includes(queued)\n', '      const cut = session.flushing !== null\n'),
        ],
    ),
    (
        "M5  · ⛔ §1 · the abandon says nothing about what it does not know, so a message that may "
        "have reached the provider is recorded with the bare word that means it never left",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same line as 234:M4
        # (const cut = ...), mutated to a different wrong value: always false. The rule protected —
        # an in-flight message must be told the truth about its uncertainty — still holds; the
        # current test suite even phrases it as 'the uncertain abandon says nothing about being
        # uncertain'. Note the consequence sharpened under D-017: with cut permanently false the
        # in-flight message is no longer merely mislabeled, it falls into the 'hand on to next
        # start' branch instead of being ended at all (same line, same defect character: the app has
        # lost track of which message is the uncertain one).
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — Same line as M4 under D-027's list-valued `handingOver`. The table already records that
        # with `cut` permanently false the mid-handover message is handed on instead of being ended
        # with the uncertain sentence. The plant is `const cut = false`. Killed by
        # `queued-message.test.ts`.
        [
            (HOST, '      const cut = session.handingOver.includes(queued)\n', '      const cut = false\n'),
        ],
    ),
    (
        "M6  · ⚠️ §1 · the handover marker is never cleared, so a send that THREW leaves it standing "
        "over a message that is still queued — and the next abandon inherits a doubt it has no right "
        "to. ⚑ Re-argued after run 1: the first label said *every* later abandon claims one, which "
        "identity comparison makes impossible; the throw is the only path the `finally` is on",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The `finally` that clears the handover marker survives D-027 but now assigns an empty
        # list: `session.handingOver = []` instead of `= null`. The rule (a send that threw must not
        # leave the marker standing over a message that stays queued, or a later Close abandons it
        # with a doubt it has no right to) is unchanged. The plant deletes that line. Killed by
        # `queued-message.test.ts`.
        [
            (HOST, '        session.handingOver = []\n', ''),
        ],
    ),
    (
        "M7  · 🔴 §1 · teardown publishes the endings without TAKING the messages — the mailbox "
        "survives, the flush finds it still holds, and the ledger gets both endings the other way "
        "round. ⚑ **Re-anchored by `394`**, which made the take a `splice` of the whole mailbox; the "
        "replacement copies it instead, so nothing is removed and every entry is still held",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — handOnWhatItHeld (renamed
        # from abandonQueued) still opens with 'const held = session.mailbox.splice(...)', and the
        # doc comment directly above it still states the reason verbatim: 'The array is emptied
        # FIRST and then walked ... so a re-entrant teardown finds nothing left to hand on.'
        # Swapping splice for a non-destructive spread plants exactly the original 'mailbox
        # survives, flush re-sends, ledger gets both endings' defect.
        [
            (HOST, '    const held = session.mailbox.splice(0, session.mailbox.length)', '    const held = [...session.mailbox]'),
        ],
    ),
    # ---- §2 · the busy selector, the closing card, the paint --------------------------------------
    (
        "M8  · 🔴 §2 · THE DEFECT (227 M4 / 228 M1), verbatim · the busy selector asks for WORDS "
        "again, so a staged file with an empty box offers neither Queue nor Interrupt-and-send",
        [
            (
                COMPOSER,
                "const busyChoices = computed(() => props.state === 'busy' && canSendNow.value)",
                "const busyChoices = computed(() => props.state === 'busy' && text.value.trim() !== '')",
            )
        ],
    ),
    (
        "M9  · ⛔ §2 · the buttons ask the new rule and the HINT asks the old one, so the sentence "
        "under the composer describes a state the controls are not in (223's tooltip defect again)",
        [
            (
                COMPOSER,
                '        <template v-else-if="busyChoices">\n          <strong>{{ sendKey }}</strong> to send after',
                '        <template v-else-if="state === \'busy\' && text.trim() !== \'\'">\n          <strong>{{ sendKey }}</strong> to send after',
            )
        ],
    ),
    (
        "M10 · ⚠️ §2 · the selector forgets it is about a BUSY turn, so an idle composer offers to "
        "queue behind a turn that is not running",
        [
            (
                COMPOSER,
                "const busyChoices = computed(() => props.state === 'busy' && canSendNow.value)",
                "const busyChoices = computed(() => canSendNow.value)",
            )
        ],
    ),
    (
        "M11 · 🔴 §2 · THE DEFECT (228 M2), verbatim · `closing` goes back below the state gate, so a "
        "conversation closed with a card open still says to answer the request above",
        [
            (
                PANE,
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n"
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n",
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. The
        # `composerState.value === 'ended'` early-out in ConversationPane's `sendBlocked` is gone,
        # because the 'ended' composer state is gone. The remedy it protected (reopen from the rail)
        # was removed with 'no Reopen / Take it over / Read the recording presses: one press, "Open
        # the conversation"'. The send-gate DOM test says: 'D-017b — `ended` was the one it did NOT
        # outrank, and it is gone'. Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ §2 · the ENDED early-out goes, so a conversation that is over is told it is closing "
        "— losing the one remedy a close does not take away (reopen it from the rail)",
        [(PANE, "  if (composerState.value === 'ended') return null\n", "")],
    ),
    (
        "M13 · ⛔ §2 · `interruptible` goes back to a constant, so the stop button is offered for a "
        "turn the close is already ending — the DEAD PROP restored",
        [
            (
                PANE,
                "const interruptible = computed(() => props.record.phase !== 'closing')",
                "const interruptible = computed(() => true)",
            )
        ],
    ),
    (
        "M14 · 🔴 §2 · the KEY stops reading it while the button keeps reading it — 094's finding "
        "upside down, one affordance gated and the others not",
        [(PANE, "  if (!interruptible.value) return\n", "")],
    ),
    (
        "M15 · ⚠️ §2 · ⚑ found in review · the paint stops following the sentence, so a closing "
        "conversation reads the closing sentence in the amber that means *frozen on YOU*",
        [
            (
                COMPOSER,
                "const frozenLook = computed(() => props.state === 'frozen' && props.blocked === null)",
                "const frozenLook = computed(() => props.state === 'frozen')",
            )
        ],
    ),
    # ---- §3 · the content rule and the fourth verb ------------------------------------------------
    (
        "M16 · 🔴 §3 · THE DEFECT (228 L1), verbatim · the host stops owning the content rule, so a "
        "main-process caller can queue a blank turn or destroy a running one to send spaces",
        [
            (
                HOST,
                "    if (!hasSomethingToSend(content.text, content.attached)) throw new Error(NOTHING_TO_SEND)\n",
                "",
            )
        ],
    ),
    (
        "M17 · ⛔ §3 · the gate asks for WORDS rather than the shared predicate, so 220's adoption "
        "blocker comes back at a THIRD layer: an attachment-only send is refused by the host",
        [
            (
                HOST,
                "    if (!hasSomethingToSend(content.text, content.attached)) throw new Error(NOTHING_TO_SEND)",
                "    if (content.text.trim() === '') throw new Error(NOTHING_TO_SEND)",
            )
        ],
    ),
    (
        "M18 · ⛔ §3 · the go-ahead stops handing over its content, so the fourth turn-taking path is "
        "the one that skips the rule — 148 H2's shape, one dispatch later",
        [
            (
                HOST,
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text: 'x', attached: 0, from: null })\n    }",
            )
        ],
    ),
    (
        "M19 · 🔴 §3 · THE DEFECT (228 M3), verbatim · the fourth wire verb goes back to `min(1)`, "
        "the rule 221 removed from the other three, so a whitespace go-ahead is an accepted command",
        [
            (
                IPC,
                "const goAheadText = z\n"
                "  .string()\n"
                "  .refine((text) => hasSomethingToSend(text, 0), NOTHING_TO_SEND)\n"
                "  .optional()",
                "const goAheadText = z.string().min(1).optional()",
            )
        ],
    ),
    (
        "M20 · ⛔ §3 · the go-ahead's text stops being OPTIONAL, so 085's leave — stopping planning "
        "without saying anything on the user's behalf — becomes a rejected command",
        [
            (
                IPC,
                "  .refine((text) => hasSomethingToSend(text, 0), NOTHING_TO_SEND)\n  .optional()",
                "  .refine((text) => hasSomethingToSend(text, 0), NOTHING_TO_SEND)",
            )
        ],
    ),
    (
        "M21 · ⛔ §3 · the wire table loses the fourth verb's row, so a rule the schema holds is "
        "described by nothing — the way a table goes quietly stale",
        [
            (
                REFUSALS,
                "    field: 'text (endPlanMode)',\n    rule: 'refine(hasSomethingToSend)',\n    verbs: ['endPlanMode'],\n",
                "    field: 'text (endPlanMode)',\n    rule: 'refine(hasSomethingToSend)',\n    verbs: [],\n",
            )
        ],
    ),
    (
        "M22 · ⚠️ §3 · a row OVER-claims its verbs, so the census measures a rule against a command "
        "that strips the field entirely and reports a refusal nobody makes",
        [
            (
                REFUSALS,
                "    field: 'attachments',\n    rule: 'max(MAX_HANDED_PATHS)',\n    verbs: SEND_VERBS,",
                "    field: 'attachments',\n    rule: 'max(MAX_HANDED_PATHS)',\n    verbs: ALL_VERBS,",
            )
        ],
    ),
    (
        "M23 · ⛔ §3 · the GATE table loses the row for the refusal the host now makes, so a throw a "
        "person can reach is described by nothing and nobody has said whether it is knowable",
        [
            (
                REFUSALS,
                "    id: 'nothing-to-send',\n    thrownBy: 'assertCanTakeTurn',\n",
                "    id: 'nothing-to-send',\n    thrownBy: 'send',\n",
            )
        ],
    ),
    # ---- §4 · a step out is a segment ------------------------------------------------------------
    (
        "M24 · 🔴 §4 · THE DEFECT (227 LOW 1), verbatim · containment goes back to a SUBSTRING test, "
        "so a legal folder named `..prefix` makes the chip say a file plainly inside is outside",
        [
            (
                HANDED,
                "  return step === '..' || step.startsWith(`..${sep}`)",
                "  return step.startsWith('..')",
            )
        ],
    ),
    (
        "M25 · ⛔ §4 · the exact-`..` case goes, so the working directory's own PARENT reads as "
        "inside it — the segment fix over-narrowed instead of over-broad",
        [
            (
                HANDED,
                "  return step === '..' || step.startsWith(`..${sep}`)",
                "  return step.startsWith(`..${sep}`)",
            )
        ],
    ),
    # ---- the instrument --------------------------------------------------------------------------
    (
        "M26 · ⛔ the live step that carries §2's gesture leaves the run, and the step census that is "
        "supposed to name exactly the steps the smoke offers says nothing",
        [
            (
                SMOKE,
                "await step('47 a message queued mid-turn waits, then sends as its own turn (077)'",
                "await step('47x a message queued mid-turn waits, then sends as its own turn (077)'",
            )
        ],
    ),
    # ---- seventeen older rows, re-anchored by this dispatch and re-run here -----------------------
    (
        "M27 · ⛔ 149 M12, re-anchored and re-run · the plan go-ahead skips the turn gate (THE H2 "
        "DEFECT)",
        [
            (
                HOST,
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
                "    if (false && text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
            )
        ],
    ),
    (
        "M28 · ⛔ 149 M13, re-anchored and re-run · the plan gate runs BELOW the release, so the plan "
        "is lost for a turn that never went",
        [
            (
                HOST,
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
                "",
            ),
            (
                HOST,
                "    await session.handle.setPlanMode(false)",
                "    await session.handle.setPlanMode(false)\n"
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
            ),
        ],
    ),
    (
        "M29 · ⛔ 149 M15, re-anchored and re-run · queueing stops asking whether the credential the "
        "conversation holds is still the machine's",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Byte-for-byte the same
        # mutation as 149:M15 (the QUEUE gate re-run in table 234): queueAs's top-of-function
        # assertCanTakeTurn('queue', ...) still exists, just wrapped in D-017's try/catch for the
        # start-it-again race. Same corrected edit and killer as 149:M15.
        [
            (HOST, "      await this.assertCanTakeTurn(session, 'queue', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n      })", "      this.assertAcceptsMessages(session, 'queue')"),
        ],
    ),
    (
        "M30 · 🔒 216 M5, re-anchored and re-run · a path OUTSIDE the working directory stops saying "
        "so, so the agent's own permission card is the first place anybody notices",
        [
            (
                HANDED,
                "  const step = relative(here, target)\n"
                "  if (step === '') return false\n"
                "  // Different roots — a UNC share, another drive — and there is no step from one to the other.\n"
                "  if (isAbsolute(step)) return true\n"
                "  return step === '..' || step.startsWith(`..${sep}`)",
                "  void relative(here, target)\n  return false",
            )
        ],
    ),
    (
        "M31 · ⛔ 216 M20, re-anchored and re-run · the ordinary SEND stops re-checking at all",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Byte-for-byte the same
        # mutation as 216:M20/232:M6, re-run at table 234's revision. Same corrected edit and
        # killer.
        [
            (HOST, '      handed = await recheckHandedPaths(attachments, session.cwd)', '      handed = { paths: [...attachments] }'),
        ],
    ),
    (
        "M32 · ⛔ 216 M21, re-anchored and re-run · the queued FLUSH stops asking whether the session "
        "can take a turn — the turn nobody pressed anything for",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — Same defect and same dark anchor as 216 M21: the flush's turn gate is now one call over
        # the turn's joined text and summed attachments. The re-run of 216 M21 keeps the rule that
        # the unattended flush still asks whether the session can take a turn. The plant is the same
        # edit, deleting that call. Killed by `sign-in-supersede.test.ts`,
        # `a-task-row-that-lies-about-its-holder.test.ts`.
        [
            (HOST, "      await this.assertCanTakeTurn(session, 'send', {\n        text: going.map(({ queued }) => queued.text).join('\\n\\n'),\n        attached: going.reduce((all, { handed }) => all + handed.paths.length, 0),\n        from: going.length === 1 && only !== undefined ? (only.queued.origin ?? null) : null,\n      })\n", ''),
        ],
    ),
    (
        "M33 · ⛔ 216 M22, re-anchored and re-run · the interrupt's SECOND check is removed — THE 148 "
        "M1 TOCTOU",
        [
            (
                HOST,
            # ⚑ **713 · corrected in place** (standing rule 27): the second gate is handed the first
            # gate's answer (`decided`, `708` H-4), so its call gained a key. Same rule, same
            # replacement; re-verified RED alone, killer named in 713's response.
            # ⚑ Re-anchored in place, not retired — the second gate now sits in a `try` that holds a
            # person's words for the reopen when the sign-in moved meanwhile; the plant removes the
            # gate and its catch together, which is the same defect.
                "    try {\n      await this.assertCanTakeTurn(session, 'send', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n        decided,\n      })\n    } catch (error) {\n      // ⚑ …and one that moved while the stop waited holds them the same way.\n      if (!aPersonIsAsking(by) || !this.aReopenCarriesIt(error, by, session)) throw error\n      await this.queueAs(\n        session.id,\n        text,\n        by,\n        attachments,\n        'work',\n        {},\n        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,\n        'after-a-lost-race',\n      )\n      return\n    }\n    // ⚠️ Asked a second time",
                "    // ⚠️ Asked a second time",
            )
        ],
    ),
    (
        "M34 · ⛔ 216 M24 (203 M30), re-anchored and re-run · ordinary `send` stops asking whether "
        "the session can take a turn",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — the ordinary send now
        # asks inside a try that waits out a stop (`onAStop: 'start-it-again'`); the question it
        # asks, whether the session can take a turn, is unchanged. The plant deletes it.
        [
            (HOST, "      await this.assertCanTakeTurn(session, 'send', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n      })\n      handed = await recheckHandedPaths(attachments, session.cwd)", '      handed = await recheckHandedPaths(attachments, session.cwd)'),
        ],
    ),
    (
        "M35 · 🔴 219 M1, re-anchored and re-run · the pane computes a reason and never has one, so "
        "Send is lit and full-accent in a conversation the host will refuse",
        [
            (
                PANE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — `708` H-3a: a third reason (a command with
                # files) follows the sign-in's; the defect planted is unchanged — no reason, ever.
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n"
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n"
                "  const command = aCommandInTheBox(props.draft, control.value.commands)\n"
                "  return command === null || props.handing.staged.length === 0\n"
                "    ? null\n"
                "    : aCommandTakesNoAttachmentsYet(command)",
                "  return null",
            )
        ],
    ),
    (
        "M36 · ⛔ 219 M5c, re-anchored and re-run · the two reasons swap precedence, so a "
        "conversation on its way out is told to reopen on the current sign-in",
        [
            (
                PANE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — `708` H-3a: the sign-in's reason is a line of
                # its own now, with the command's after it; the defect planted is unchanged — the
                # sign-in and the close swap places.
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n"
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n",
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n"
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n",
            )
        ],
    ),
    (
        "M37 · ⛔ 219 M7, re-anchored and re-run · the busy branch loses its `blocked` guard, so "
        "`queue-prompt` and `interrupt-send-prompt` are lit over a reason the pane already holds",
        [
            (
                COMPOSER,
                '<template v-if="busyChoices">',
                "<template v-if=\"state === 'busy' && text.trim() !== ''\">",
            )
        ],
    ),
    (
        "M38 · ⛔ 221 M9, re-anchored and re-run · the wire table loses a row, so a rule the schema "
        "holds is described by nothing",
        [
            (
                REFUSALS,
                "  {\n"
                "    field: 'attachments[].outsideCwd',\n"
                "    rule: 'boolean()',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: 'here', attachments: [{ ...A_PATH, outsideCwd: 'yes' }] },\n"
                "    composerHolds:\n"
                "      'The other half of the same caption, and the half that IS still thrown away — main decided ' +\n"
                "      'it, the renderer only carried it back, and `recheckHandedPaths` decides it again before the ' +\n"
                "      'turn goes out (232 §1: it is a fact about a folder, not about the thing chosen).',\n"
                "    verdict: 'composer-cannot',\n"
                "  },\n",
                "",
            )
        ],
    ),
    (
        "M39 · ⛔ 221 M10, re-anchored and re-run · a row's PROBE stops breaking the rule it names, "
        "so the row describes a rule that may not exist",
        [
            (
                REFUSALS,
                "    field: 'text',\n"
                "    rule: 'refine(hasSomethingToSend)',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: '   ' },",
                "    field: 'text',\n"
                "    rule: 'refine(hasSomethingToSend)',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: 'words' },",
            )
        ],
    ),
    (
        "M40 · ⛔ 232 M6 (216 M20), re-anchored and re-run · the ordinary SEND stops re-checking, so "
        "a path replaced between the chip and the press is sent as what the person attached",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Byte-for-byte the same
        # mutation as 216:M20/232:M6/234:M31, re-run again. Same corrected edit and killer.
        [
            (HOST, '      handed = await recheckHandedPaths(attachments, session.cwd)', '      handed = { paths: [...attachments] }'),
        ],
    ),
    (
        "M41 · ⛔ 232 M9 (216 M24), re-anchored and re-run · ordinary `send` stops asking whether the "
        "session can take a turn",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Byte-for-byte the same
        # mutation as 216:M24/232:M9, re-run again. Same corrected edit and killers.
        [
            (HOST, "    try {\n      await this.assertCanTakeTurn(session, 'send', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n      })\n      handed = await recheckHandedPaths(attachments, session.cwd)\n    } catch (error) {", '    try {\n      handed = await recheckHandedPaths(attachments, session.cwd)\n    } catch (error) {'),
        ],
    ),
    (
        "M42 · ⛔ 232 M14 (221 M9), re-anchored and re-run · the wire table loses a row",
        [
            (
                REFUSALS,
                "  {\n"
                "    field: 'attachments[].outsideCwd',\n"
                "    rule: 'boolean()',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: 'here', attachments: [{ ...A_PATH, outsideCwd: 'yes' }] },\n",
                "  {\n"
                "    field: 'attachments[].outsideCwd',\n"
                "    rule: 'boolean()',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: 'here', attachments: [{ ...A_PATH, outsideCwd: true }] },\n",
            )
        ],
    ),
    (
        "M43 · 🔒 232 M24 (216 M5), re-anchored and re-run · a path OUTSIDE the working directory "
        "stops saying so, on the ONE-observation form",
        [
            (
                HANDED,
                "  const step = relative(here, target)\n"
                "  if (step === '') return false\n"
                "  // Different roots — a UNC share, another drive — and there is no step from one to the other.\n"
                "  if (isAbsolute(step)) return true\n"
                "  return step === '..' || step.startsWith(`..${sep}`)",
                "  void relative(here, target)\n  return true",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
