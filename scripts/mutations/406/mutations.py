"""406 · finished, and finished with a question — each row is THE DEFECT, put back (131).

🔴 **HO-019 §2 named a property and refused to name a shape.** ⚑ The PO's words, verbatim:

> ⚑ **A person must be able to tell, AT A GLANCE AND WITHOUT READING, the difference between
> *finished and needs nothing from me* and *finished and needs a decision*.**
>
> ⛔ **What must not happen is a rail row reading `done` with no visible difference when a
> decision is waiting.**

## ⛔ There was no row, and the row there was said the person had written it

⚠️ **`TaskRow` never crossed IPC and no surface drew one.** The transcript declines a row for
`task_replied` twice over — *"what a task is FOR is a board"* — and the board does not exist. ⛔ So
what a person met was the reply's WORDS, arriving in the parent's transcript through `queueMessage`
as a plain `user_turn` and drawn by `UserMessage.vue` **under `<strong>You</strong>`**.

| the fact | where it lives |
|---|---|
| `214` removed 12,646 messages that rendered injected material as *"You"* | `UserMessage.vue`'s own docblock |
| `278` built `ContinuationEntry.vue` so the go-ahead would not be one more | *"never `UserMessage.vue` with a badge"* |
| ⛔ `393`'s reply and `400`/`404`'s undriven notice shipped as two more, AFTER both | `deliverReply`, `tellOneParent` |

🔴 **And the fact a decision hangs on was the last paragraph of the prose.** `needs_user_action`
appeared in no `.vue` file at all; its one path into the renderer was a raw event-log line with
`(ours)` appended.

## ⚑ The shape of the fix, and therefore the shape of this table

⛔ **The authorship and the SUBJECT travel together, in one spread.** `attribution: 'app_authored'`
says BroBot wrote the words — true of three producers — and `UserTurnEvent.work` says which of the
three this is. ⚠️ A row that could write one without the other is either `214`'s defect with a
payload attached (`M2`) or a worker's answer drawn under the go-ahead's *"sent for you"* (`M17`).

⛔ **And it rides the HELD path**, because a parent with two children is busy exactly when one of
them finishes — `M3`, `M4`, `M5`.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M20`, `M32`, `M34`–`M35` | ⚑ **`run_suite`** — `apps/desktop/test/finished-and-finished-with-a-question.test.ts` |
| `M21`–`M31`, `M33`, `M36` | ⚑ **`run_dom`** — `apps/desktop/test/dom/work-report.dom.test.ts` |

⚠️ **Every row was applied ALONE and watched go red against the file named here**, before the table
existed — `verify-each-mutation-row-without-running-the-table`. ⛔ No table was run.

🔴 **Two rows survived that pass, and both were coverage holes rather than bad rows.** Deleting the
mark's `#i-user` glyph killed nothing — the property is *at a glance and WITHOUT READING* and every
assertion was reading four words; and a `flex-wrap` flip killed nothing because this line holds at
most two short pills and the only long one can never share a row with a mark. ⚑ The first became an
assertion (`M26` now dies against it); the second became a line that carries no rule and was
removed, and `M27` is a different defect on the pill beside it.

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting the `work` field from the wire, the `WorkReportItem` from the union, or the
`v-else-if` from `TranscriptView`.** Each is a compile error, and
`a-mutation-on-a-census-is-invisible-to-that-census` is the other half.

⛔ **No row on the routed question.** `394`'s injected turn is STILL unmarked and that is a stated
finding rather than a slip — marking it without building its entry would draw a child's question
under the go-ahead's authorship line. ⚑ It is pinned by an assertion (§8) rather than by a row,
because the row would be *the feature is not built*.

⛔ **No row flipping the mark's text to the sentence.** ⚠️ It reads as a row and is not one: the
sentence is COMPOSED from the mark (`A_PERSON_MUST_ACT_SENTENCE`), so a row rewriting one rewrites
both and the comparison it would test cannot diverge — `a-comparison-tested-where-both-sides-agree`.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
WORDS = "apps/desktop/src/renderer/src/lib/work-report.ts"
FACTS = "apps/desktop/src/renderer/src/components/WorkFacts.vue"
ENTRY = "apps/desktop/src/renderer/src/components/WorkReportEntry.vue"
QUEUED = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
BADGE = "apps/desktop/src/renderer/src/components/StateBadge.vue"
STREAM = "apps/desktop/src/renderer/src/lib/describe-event.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# ⚠️ **RE-POINTED at 413, not retired** (`correct-a-stale-mutation-anchor-dont-retire-it`). `413`
# moved the writer out of these two expressions and into `whoseWordsTheseAre`, because marking each
# producer by hand missed two of them — `410` counted the residue live. ⛔ The rows below still
# delete or weaken the ONE place the authorship is written; the place moved.
# ⚑ ANCHOR CORRECTED IN PLACE BY 687: `sendAs` now passes the caller's declaration (`678` H1).
# The defect each row plants — the sent turn losing its authorship — is unchanged.
SEND_SPREAD = "      ...whoseWordsTheseAre(by, this.profileOf, facts, declared),\n"
# ⚑ ANCHOR CORRECTED IN PLACE BY 687: the held rows spread the entry's authorship too since R22, so the flush's line is no
# longer unique alone; it is named with the comment that follows it. The row is unchanged.
# ⛔ **The tail is a WHOLE comment prefix, and every replacement re-emits it** (`687`'s review): an
# anchor that ends inside a comment and a replacement that drops it leaves the comment's remainder as
# bare code, and the mutant is a parse error rather than the row's defect.
FLUSH_TAIL = "      // 🔴 **671 · the task rides the held message to the turn it becomes**"
FLUSH_SPREAD = "      ...queued.authorship,\n" + FLUSH_TAIL

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the authorship, which is the shipped defect ───────────────────────────────────────
    (
        "M1 · 🔴 the shipped defect, put back · a child's reply reaches its parent as a plain "
        "`user_turn`, so `UserMessage.vue` draws a worker's answer under `<strong>You</strong>` "
        "with the person's own avatar beside it. ⚠️ `214` removed 12,646 messages of exactly this "
        "shape and `278` built a whole component so the go-ahead would not be one more",
        [(HOST, SEND_SPREAD, "")],
    ),
    (
        "M2 · ⛔ the facts travel under the person's name · the subject is written and the "
        "authorship is not, so the row carries the outcome and the mark and is still attributed to "
        "somebody who never typed it — `214`'s defect wearing a payload, and the reason the two "
        "keys are ONE spread rather than two statements",
        [
            (
                HOST,
                SEND_SPREAD,
                # ⚑ **CORRECTED BY 687** (from its review): this read `report`, which nothing in
                # `sendAs` binds since `413` moved the writer, so the mutant was a ReferenceError on
                # every send rather than *the subject written and the authorship not*.
                "      ...(facts.report === undefined ? {} : { work: facts.report }),\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the FLUSH forgets · a reply to a BUSY parent is held, and the turn it becomes is "
        "published from the mailbox record — so a report carried only on the queue-time event is "
        "dropped by exactly the branch a parent with two children takes. ⚑ The row flips from a "
        "work card back to *You* the moment the parent's turn ends",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. runFlush must carry the held entry's authorship (attribution, work, relayed-from)
        # onto the message it becomes when it is flushed to the provider. The spread
        # `...queued.authorship,` is still in runFlush, followed by the 671 comment. The plant drops
        # the spread and keeps the comment. Killed by
        # `finished-and-finished-with-a-question.test.ts`.
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
            (HOST, "        ...queued.authorship,\n        // 🔴 **671 · the piece rides the held message to the turn it becomes**", "        // 🔴 **671 · the piece rides the held message to the turn it becomes**"),
        ],
    ),
    (
        "M4 · ⛔ the mailbox does not hold it · one layer under `M3`: the held message keeps its "
        "text and its attachments and loses what it is ABOUT, so nothing at the flush has a report "
        "to put on the turn",
        # ⚠️ **Re-pointed at 413**: the mailbox carries the whole authorship rather than a bare
        # report, so the row that empties it is an empty VALUE rather than a deleted line.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 687: the entry's authorship now carries the caller's declaration.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. queueAs must store whoseWordsTheseAre(...) on the held entry so a later flush knows
        # whose words these were. The line is unchanged at the new site. The plant stores an empty
        # authorship. Killed by `finished-and-finished-with-a-question.test.ts`,
        # `whose-words-a-row-carries.test.ts`.
        [
            (HOST, '      authorship: whoseWordsTheseAre(by, this.profileOf, facts, says ?? undefined),\n', '      authorship: {},\n'),
        ],
    ),
    (
        "M5 · ⛔ the held ROW is the person's for the length of a turn · `message_queued` carries "
        "no subject, so a reply waiting behind a running turn sits in the transcript under *You* "
        "with a cancel button offering to take back words nobody wrote — and then silently becomes "
        "a work card. ⚠️ The window a person is actually watching",
        # The queued message must publish the held entry’s own authorship. Several writers spread
        # held.authorship at the same indent, so include the surrounding busy-mailbox context to
        # select this writer exactly once. The mutation drops that spread, leaving the message’s
        # subject absent.
        [
            (HOST, "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...held.authorship,\n", "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n"),
        ],
    ),
    (
        "M6 · ⛔ the undriven notice keeps the old defect · `400`/`404`'s *is not being worked on* "
        "still arrives as the person's own bubble, so half the surface is a record and half is a "
        "message the reader is told they wrote. ⚑ A reply and a notice are ONE surface to a reader",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 hands the report the kept-open fact its words read; the row still removes the whole report. The DEFECT this row plants is unchanged.
        # ⚑ **707 · re-anchored in place, not retired** — R40 gave the report the giver's project; the row still sends the notice with no report.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: the
        # undriven notice must carry its work report, so it is drawn as a notice and not as the
        # person's own bubble. `workUndriven` lost its fourth (giver's project) argument, so the
        # call is now `workUndriven(task, cause, keptOpen)`. The plant deletes that argument line
        # and leaves the call valid.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. The stall notice must carry the stalled piece's report (workUndriven with the cause
        # and whether the holder was kept open) as the app-authored work on the message. The
        # argument is still the last queueMessage argument in tellOneParent. The plant removes it.
        # Killed by `finished-and-finished-with-a-question.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule holds: the undriven notice must carry its work report so it is drawn as
        # app-authored work and not as the person's own bubble. The call in tellOneParent is now `{
        # report: workUndriven(piece, cause) },` because D-016c dropped the kept-open argument
        # (`workUndriven(piece, cause)` has two args), and the plant removes that last queueMessage
        # argument. Killed by `finished-and-finished-with-a-question.test.ts`.
        [
            (HOST, '        { report: workUndriven(piece, cause) },\n', ''),
        ],
    ),
    (
        "M7 · ⛔ the reply reports the row it was HANDED · `deliverReply` is given the task as it "
        "was BEFORE the reply, so a report that copied `TaskRow.state` says `working` about an "
        "answer — the facts contradicting the sentence printed beside them",
        [(RAILS, "    state: 'answered',\n", "    state: 'working',\n")],
    ),
    (
        "M8 · 🔴 absence stops meaning *the agent said no* · every reply carries the key, so the "
        "three-valued reading collapses to two and a row can no longer tell *nobody has said* from "
        "*the agent asked nothing of you*. ⚠️ §4's *`null` is not `false`*, landing on the meaning",
        [
            (
                RAILS,
                "    ...(reply.needsUserAction ? { needsUserAction: true as const } : {}),\n",
                "    needsUserAction: reply.needsUserAction as true,\n",
            )
        ],
    ),
    (
        "M9 · ⛔ the notice reports no cause · the stall's whole glance goes: the pill falls back "
        "to the state word, which only repeats what the row already is, and *the app restarted "
        "while it was open* — the fact a parent decides on — is left in the prose alone",
        [(RAILS, "    stalledBecause: cause,\n", "")],
    ),
    # ── §2 · the reading, and the three values a boolean has here ──────────────────────────────
    (
        "M10 · 🔴 the flag is read TRUTHILY · `toPersistedEvents` casts and an imported `.brobot` "
        "bundle is written through `.passthrough()`, so `\"no\"`, `0` and `false` are bytes "
        "somebody can hand this app — and the string `\"no\"` becomes a claim that a person must act",
        [
            (
                WORDS,
                "  if (report.needsUserAction === true && report.state === 'answered') return 'must-act'\n",
                "  if (report.needsUserAction && report.state === 'answered') return 'must-act'\n",
            )
        ],
    ),
    (
        "M11 · ⛔ the STATE stops qualifying the claim · an absent flag reads as *the agent said "
        "no* on every report, including the ones no agent has answered — a row telling a person "
        "that a worker asked nothing of them about work that has not come back",
        [
            (
                WORDS,
                "  return report.state === 'answered' ? 'asked-nothing' : 'nobody-has-said'\n",
                "  return 'asked-nothing'\n",
            )
        ],
    ),
    (
        "M12 · 🔴 the mark is drawn on EVERY finished task · the difference HO-019 §2 asks for "
        "disappears in the direction that costs most: every `done` row claims a person must act, "
        "so the one that does is no longer tellable from the one that does not",
        [
            (
                WORDS,
                "  return personsPart(report) === 'must-act' ? A_PERSON_MUST_ACT : null\n",
                "  return report.state === 'answered' ? A_PERSON_MUST_ACT : null\n",
            )
        ],
    ),
    (
        "M13 · ⛔ the cause stops being preferred to the state word · the stall pill reads *not "
        "being worked on*, which only restates the state, and the cause survives only in the "
        "paragraph — the glance the photograph was taken to fix",
        [
            (
                WORDS,
                "    word: undrivenReason(report.stalledBecause) ?? stateWord(report.state),\n",
                "    word: stateWord(report.state),\n",
            )
        ],
    ),
    (
        "M14 · ⛔ an unknown state prints `undefined` · the fallback goes, and a row folded from an "
        "imported ledger draws the literal word `undefined` where its state belongs — `403`'s "
        "`CHANNEL_REFUSAL_SENTENCES` fallback, one vocabulary over",
        [
            (
                WORDS,
                "  return Object.hasOwn(WORK_STATE_WORD, state)\n    ? WORK_STATE_WORD[state]\n    : 'in a state this app has not been taught'\n",
                "  return WORK_STATE_WORD[state]\n",
            )
        ],
    ),
    (
        "M15 · 🔴 an unknown cause THROWS · `undrivenSentence` calls `.replace` on the lookup, so a "
        "cause this app has never heard of takes the whole transcript down. ⚑ Its other two callers "
        "read a value the fold produced; this one reads a wire",
        [
            (
                WORDS,
                "  return Object.hasOwn(UNDRIVEN_SENTENCES, cause) ? undrivenSentence(cause) : null\n",
                "  return cause in UNDRIVEN_SENTENCES ? undrivenSentence(cause) : null\n",
            )
        ],
    ),
    (
        "M16 · ⛔ an outcome nobody can draw reaches the badge · `TASK_OUTCOME_LOOK[bogus]` is "
        "`undefined`, and the badge is built from a look that has no token and no tint",
        [
            (
                WORDS,
                "  return outcome !== undefined && (TASK_OUTCOMES as readonly string[]).includes(outcome)\n    ? outcome\n    : null\n",
                "  return outcome ?? null\n",
            )
        ],
    ),
    # ── §3 · the fold ──────────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 the AUTHORSHIP picks the entry · a worker's answer is drawn as "
        "`ContinuationEntry` — *sent for you*, under the go-ahead's own authorship line — which is "
        "false of every report and is one word answering two questions (`395`)",
        [
            (
                'apps/desktop/src/renderer/src/lib/transcript.ts',
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the relayed turn's call now also hands `says` (`687` H1) and wrapped; the row's defect is unchanged.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Keep the current relay arguments, but remove work-report priority so relayed reports choose the relay entry.
                "      if (isAWorkReport(event.work))\n        appendWorkReport(\n          state,\n          event.text,\n          event.work,\n          wasRelayed(event.relayedFrom)\n            ? {\n                relayedFromProfile: relayerIdentity(event.relayedFromProfile),\n                relayedFrom: event.relayedFrom,\n              }\n            : null,\n        )\n      else if (wasRelayed(event.relayedFrom))\n        appendRelayedTurn(\n          state,\n          event.text,\n          relayerIdentity(event.relayedFromProfile),\n          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n          isAgentMessageKind(event.says) ? event.says : undefined,\n          event.relayedFrom,\n        )\n",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the relayed turn's call now also hands `says` (`687` H1) and wrapped; the row's defect is unchanged.
                "      if (wasRelayed(event.relayedFrom))\n        appendRelayedTurn(\n          state,\n          event.text,\n          relayerIdentity(event.relayedFromProfile),\n          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n          isAgentMessageKind(event.says) ? event.says : undefined,\n          event.relayedFrom,\n        )\n",
            ),
        ],
    ),
    (
        "M18 · ⛔ the held row loses its subject in the FOLD · the event carries the report and the "
        "item does not, so `QueuedMessage` has nothing to key on and falls back to *You* — `M5` "
        "one layer nearer the screen",
        [
            (
                FOLD,
                "        // \u2691 **406** \u2014 see {@link QueuedItem.report}. A reply held behind a running turn is drawn\n        // here until it flushes, and it is not the person's message.\n        ...(isAWorkReport(event.work) ? { report: event.work } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M19 · ⛔ the row is not a TURN · `045` opens a turn row from `user_turn` and from nothing "
        "else, and the provider really received these words — a fold that counted it as chrome "
        "would leave the turn it started with no row",
        [
            (
                'apps/desktop/src/renderer/src/lib/transcript.ts',
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Preserve new relay-navigation fields on the work report and omit only its turn-count bump.
                "  state.items.push({\n    kind: 'workReport',\n    id: nextId(state, 'workReport'),\n    text,\n    report,\n    ...(relayer === null ? {} : { relayed: true as const }),\n    ...relayNavigation(relayer?.relayedFrom),\n    ...(relayer?.relayedFromProfile === undefined\n      ? {}\n      : { relayedFromProfile: relayer.relayedFromProfile }),\n  })\n  state.changes.turn += 1\n",
                "  state.items.push({\n    kind: 'workReport',\n    id: nextId(state, 'workReport'),\n    text,\n    report,\n    ...(relayer === null ? {} : { relayed: true as const }),\n    ...relayNavigation(relayer?.relayedFrom),\n    ...(relayer?.relayedFromProfile === undefined\n      ? {}\n      : { relayedFromProfile: relayer.relayedFromProfile }),\n  })\n",
            ),
        ],
    ),
    (
        "M20 · 🔴 the row is hidden in `normal` · a person sees the work finish nowhere and the "
        "fact is behind a debug toggle — the whole defect restored in the harder direction, and "
        "`continuation`'s own ruling one case over",
        [
            (
                MODE,
                "    case 'workReport':\n      return true\n",
                "    case 'workReport':\n      return mode === 'debug'\n",
            )
        ],
    ),
    # ── §4 · the surface, measured on a real screen ────────────────────────────────────────────
    (
        "M21 · 🔴 the finished badge goes AMBER · `done` is re-hued to the token the status grammar "
        "reserves for *frozen, waiting for a human*, so a finished task is drawn as a frozen one "
        "and a person loses the difference between *a child is stuck* and *work finished and "
        "raised a decision*. ⚠️ HO-019 §2's trap, taken",
        [
            (
                BADGE,
                "  done: { label: 'Done', token: '--success', tint: '--success-bg' },\n",
                "  done: { label: 'Done', token: '--waiting', tint: '--waiting-bg' },\n",
            )
        ],
    ),
    (
        "M22 · ⛔ a blocked task reads as a finished one · `blocked` takes the green, so the row "
        "that says *the work was not done and somebody else must unblock it* is the same colour as "
        "the row that says it was done",
        [
            (
                BADGE,
                # ⚠️ **Anchored on the PAIR** — the identical line is in `CONDITION_LOOK` too, and
                # a single-line anchor resolves twice.
                "  blocked: { label: 'Blocked', token: '--danger', tint: '--danger-bg' },\n"
                "  failed: { label: 'Failed', token: '--danger', tint: '--danger-bg' },\n",
                "  blocked: { label: 'Blocked', token: '--success', tint: '--success-bg' },\n"
                "  failed: { label: 'Failed', token: '--danger', tint: '--danger-bg' },\n",
            )
        ],
    ),
    (
        "M23 · 🔴 the MARK takes the amber ramp · the achromatic mark becomes a summons, which is "
        "the one thing §3 of this dispatch forbids: it merges the finished-with-a-decision row "
        "with `401`/`403`'s frozen queue. ⚑ `390` shipped exactly this class of defect and it took "
        "a photograph to see",
        [
            (
                FACTS,
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
                ".wr-mark {\n  display: inline-flex;\n  height: 20px;\n  align-items: center;\n  padding: 0 var(--space-4);\n  border: var(--border-width) solid var(--line-strong);\n  border-radius: var(--radius-pill);\n  background: var(--wash-2);\n  color: var(--text-soft);\n",
                ".wr-mark {\n  display: inline-flex;\n  height: 20px;\n  align-items: center;\n  padding: 0 var(--space-4);\n  border: var(--border-width) solid var(--waiting-pill-border);\n  border-radius: var(--radius-pill);\n  background: var(--waiting-bg);\n  color: var(--waiting-text-label);\n",
            )
        ],
    ),
    (
        "M24 · ⛔ the mark reads as a PLACEHOLDER · dashed and `--faint` is `SoonChip`'s look, and "
        "in this app that means *not built yet* — worn by the realest thing on the row, the claim a "
        "decision hangs on",
        [
            (
                FACTS,
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
                "  border: var(--border-width) solid var(--line-strong);\n  border-radius: var(--radius-pill);\n  background: var(--wash-2);\n  color: var(--text-soft);\n  font-size: var(--type-caption);\n  font-weight: var(--fw-bold);\n  gap: var(--space-3);\n",
                "  border: var(--border-width) dashed var(--line);\n  border-radius: var(--radius-pill);\n  background: transparent;\n  color: var(--faint);\n  font-size: var(--text-4xs);\n  font-weight: var(--fw-bold);\n  gap: var(--space-3);\n",
            )
        ],
    ),
    (
        "M25 · ⛔ the mark grows the row · a facet arriving makes the line taller than the same line "
        "without it, so two rows a person is meant to compare no longer line up — `AgentState`'s "
        "own no-reflow contract, one surface over",
        [
            (
                FACTS,
                ".wr-mark {\n  display: inline-flex;\n  height: 20px;\n",
                ".wr-mark {\n  display: inline-flex;\n  height: 34px;\n",
            )
        ],
    ),
    (
        "M26 · 🔴 the mark's icon goes · the glance becomes four words a reader has to READ, beside "
        "another pill of four words — and *at a glance and WITHOUT READING* is the property the "
        "whole dispatch is for",
        [
            (
                FACTS,
                '      <svg class="icon"><use href="#i-user" /></svg>\n',
                "",
            )
        ],
    ),
    (
        "M27 · ⛔ the STALL pill goes amber · the same trap as `M23` one report over — the neutral "
        "grammar is spent on the row that says nothing is driving the work, which is a condition "
        "on OPEN work and still not a summons: `401`/`403` own that channel and this row is not in "
        "it. ⚑ Its first version was a `flex-wrap` flip and the verifier could not kill it",
        [
            (
                FACTS,
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
                ".wr-word {\n  display: inline-flex;\n  height: 20px;\n  align-items: center;\n  padding: 0 var(--space-4);\n  border: var(--border-width) solid var(--line);\n  border-radius: var(--radius-pill);\n  background: var(--wash-2);\n  color: var(--text-soft);\n",
                ".wr-word {\n  display: inline-flex;\n  height: 20px;\n  align-items: center;\n  padding: 0 var(--space-4);\n  border: var(--border-width) solid var(--waiting-pill-border);\n  border-radius: var(--radius-pill);\n  background: var(--waiting-bg);\n  color: var(--waiting-text-label);\n",
            )
        ],
    ),
    (
        "M28 · 🔴 the row is the PERSON's again · the avatar goes solid, so the one signal available "
        "to somebody scrolling past without reading — dashed where the person's is solid — is gone "
        "and the two kinds of row look the same",
        [
            (
                ENTRY,
                "  border: 1px dashed var(--line-strong);\n  border-radius: var(--radius-md);\n  background: var(--wash-2);\n  color: var(--muted);\n  place-items: center;\n",
                "  border: 1px solid var(--line-strong);\n  border-radius: var(--radius-md);\n  background: var(--wash-2);\n  color: var(--muted);\n  place-items: center;\n",
            )
        ],
    ),
    (
        "M29 · ⛔ the row stops saying who put it there · the meta row names the task and nothing "
        "else, so a reader meets a card in their own conversation with no author at all — and the "
        "`.why` paragraph that used to say it was removed because it repeated three times a screen",
        [
            (
                ENTRY,
                '        <span class="about" data-cy="work-report-about">{{ WORK_REPORT_MARK }}</span>\n',
                "",
            )
        ],
    ),
    (
        "M30 · 🔴 the HELD reply is the person's · `QueuedMessage` falls back to *You*, which is "
        "where this defect actually shipped: a worker's answer under the person's name with a "
        "cancel button beside it",
        [
            (
                QUEUED,
                # ⚠️ **Re-pointed at 413**, which gave the same computed a second answer.
                # ⚑ **And again at 508**, which gave `WorkFacts` the READING rather than the report —
                # so this component reads `workReading` once for the row and the heading asks the
                # computed. ⛔ The DEFECT is unchanged: a worker's answer under the person's name,
                # with a cancel button beside it. Re-verified RED after the move.
                "  if (reading.value !== null) return reading.value.heading\n",
                "  if (reading.value !== null) return 'You'\n",
            )
        ],
    ),
    (
        "M31 · ⛔ the held row shows no facts · the mark is invisible for exactly as long as the "
        "parent's turn runs, which is the window a person is watching the conversation it is about",
        [
            (
                QUEUED,
                # ⚑ **508 re-anchored this and the ROW is unchanged** — `WorkFacts` takes the
                # reading now, because its third caller is not a report at all. The element this
                # deletes is the same element. Re-verified RED after the move.
                '      <WorkFacts v-if="reading" :reading="reading" />\n',
                "",
            )
        ],
    ),
    # ── §5 · the four the review found, put back ───────────────────────────────────────────────
    (
        "M33 · 🔴 the person-only controls come back on a row nobody typed · *Cancel it* destroys a "
        "child's already-recorded reply on its way to the parent — and on an undriven-work notice "
        "it suppresses it PERMANENTLY, because `workReportedTo` withdraws `404`'s receipt on "
        "`abandoned` and never on `cancelled`. ⚠️ *Put it back in the composer* is worse in kind: "
        "it loads BroBot's words into the person's draft to be sent under their name · killed by `work-report.dom.test.ts`",
        # ⚠️ **Re-pointed at 413**, which widened the gate from *a report* to *not the person's*.
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the actions gate also asks whether a composer can take the words back; the plant still drops the not-the-person's-row half, so Cancel and Put it back come back on a reply nobody typed
        [(QUEUED, "        <div v-if=\"!theirs && (waiting() || props.canRestore)\" class=\"msg-actions\">\n", "        <div v-if=\"waiting() || props.canRestore\" class=\"msg-actions\">\n")],
    ),
    (
        "M34 · ⛔ a `work` that is not a report SHAPE reaches the row · `taskId` and `number` are "
        "PRINTED and have no guard of their own, so a `work: \"hello\"` on an imported ledger "
        "passes `!== undefined` and draws *Task #undefined*. ⚑ Three fields are guarded against a "
        "value this app has never heard of; the SHAPE of the value was the one thing nothing checked",
        [
            (
                'apps/desktop/src/renderer/src/lib/transcript.ts',
                '      if (isAWorkReport(event.work))\n        appendWorkReport(\n',
                '      if (event.work !== undefined)\n        appendWorkReport(\n',
            ),
        ],
    ),
    (
        "M35 · ⛔ an ENDING with no beginning is rebuilt as the person's · `054` pages the "
        "transcript, so a window can hold `message_unqueued` without ever seeing the queueing — and "
        "the fold rebuilds the row from that event alone. ⚑ Without the report on the ending the "
        "defect this dispatch removes reappears on the one path that never sees the row it repaired",
        # ⚑ **Anchor CORRECTED by `638`, not retired** — `correct-a-stale-mutation-anchor-dont-retire-it`.
        # ⛔ **The SUBJECT did not move**: `abandonQueued` still publishes `message_unqueued:'abandoned'`
        # with `heldAuthorship`, and this row still removes it. ⚠️ What moved is the METHOD'S TAIL —
        # `638` added `if (abandoned.length > 0) this.theWorldMoved('work')` after the loop, so the
        # anchor's trailing `  }` is no longer adjacent. ⚑ Shortened to the loop's own close, which is
        # unique. 🔴 **Re-verified RED by hand against its own killer file.**
        [
            (
                HOST,
                # ⚠️ **The TEARDOWN abandon, and the cancel site is deliberately not the anchor.**
                # A person can no longer cancel one of these (`M33`), so the cancel branch is
                # reachable only from the IPC verb — and a row nothing can drive is a row that
                # survives. ⚑ This branch is reached by an ordinary quit holding a reply.
                # ⚠️ **Re-pointed at 413** — the ending takes the subject through `heldAuthorship`.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 687: `heldAuthorship` is gone (R22); the ending spreads the authorship whole.
                "        ...queued.authorship,\n      })\n    }\n",
                "      })\n    }\n",
            )
        ],
    ),
    (
        "M36 · ⛔ the held row and the flushed row stop saying the same thing · they are ONE row a "
        "few seconds apart, and a second spelling is how the held half came to name no author at "
        "all while the flushed half named BroBot. ⚠️ `331`'s remedy is that a constant spelled in "
        "two places is pinned in a test; this one is spelled once",
        [
            (
                'apps/desktop/src/renderer/src/components/QueuedMessage.vue',
                '          <span v-if="item.report" class="about" data-cy="queued-about">{{\n            WORK_REPORT_MARK\n          }}</span>\n',
                '          <span v-if="item.report" class="about" data-cy="queued-about">work you gave out</span>\n',
            ),
        ],
    ),
    # ── §6 · one vocabulary ────────────────────────────────────────────────────────────────────
    (
        "M32 · ⛔ the raw stream spells the claim its own way · `needs a person` was a THIRD "
        "spelling of one fact, and the stream is the surface a debugger joins to the row a person "
        "read — two accounts of what a worker said, in the two places somebody compares them",
        [
            (
                STREAM,
                "      }${event.needsUserAction === true ? ` · ${A_PERSON_MUST_ACT}` : ''} (ours)`",
                "      }${event.needsUserAction === true ? ' · needs a person' : ''} (ours)`",
            )
        ],
    ),
]
