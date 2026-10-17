"""636 · Three surfaces read the new field, and one word is not reused.

⛔ **Ordered by `621` §5's table and its F2** — the renderer half `621` built the wire for and
deliberately left. ⚑ `HO-095` §5.1 is the defect in the person's own words: *"BroBot's header, avatar
and rail row read `Idle` while Task #1 was being worked on by Ada."*

## 🔴 What the dispatch decided, and therefore what has to be killable

 * **A SIXTH facet**, {@link AgentFacets.waiting}, because the five that exist are all read off
   `control` — this window's fold of a conversation's own ledger — and a child's `task_replied`
   goes into the CHILD's ledger. ⛔ No window can derive this from its own stream (`621` §4).
 * **A TENTH standing, `elsewhere`** — *not driving a turn, and the next move belongs to another
   agent*. ⚑ That is the word `621` §5.2 refused to choose, and two of the three waits are true
   of it because a worker and a giver are both AGENTS by construction.
 * **The third wait stays a person's.** `waiting-on-a-person` raises `waiting`, the amber, and
   `SideRail`'s `needingCount` — correctly: the row is in the person's queue and the person can clear
   it.

## The row groups

 * `M1`-`M5`   🔴 **the word is not reused** — the standing collapses back onto `waiting`, the
                person/agent split moves either way, and the amber comes back by the tone.
 * `M6`-`M9`   ⛔ **the field reaches the three surfaces** — each hop dropped in turn.
 * `M10`-`M12` ⚠️ **the three absences** — collapsed into an answer, and an absence talking over
                `unknown`.
 * `M13`-`M14` ⚑ **the precedence** — the two neighbours it was placed between.
 * `M15`-`M18` ⛔ **the words** — the refinement, the label, the sentence a screen reader hears,
                and the v2.3 hole.

## ⚠️ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row removes `RuntimeScreen`'s poll.** `readWhatIsWaiting` and its two tick lines have
   no test that drives them — the window's polls are wired in `onMounted` and nothing in this
   repository mounts `RuntimeScreen`. ⚑ A row deleting `void readWhatIsWaiting()` would record as
   a SURVIVOR and would be right to: the coverage is genuinely absent, and
   `a-line-no-mutation-can-kill-is-not-carrying-its-rule` says to report that rather than to
   invent a row for it. ⚠️ **Named in `636`'s response as coverage this dispatch did not add.**
 * ⚠️ **No row makes the new word too LONG for the rail.** `waiting on a worker` is 19 characters
   against `waiting: permission`'s 19, and the 208px column draws both — measured in
   `three-surfaces-read-the-new-field.dom.test.ts` §1 rather than asserted by a mutation that
   would fit and record as a survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`).
 * ⛔ **No row on the project band or the Team card.** `621` F3: both build a `SessionFacetInput`
   with no `needing` key at all, so neither can wear a wait even now. ⚑ That is a second
   dispatch's work and `636` reported it rather than widening its own scope.

## ⚑ WRITTEN, not run

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** No
`mutations.txt` exists at this HEAD and its absence is the honest state.
"""

from __future__ import annotations

STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"
WAITS = "apps/desktop/src/renderer/src/lib/conversation-waits.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
PROJECTION = "apps/desktop/src/renderer/src/lib/status-projection.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the word is not reused ────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the word `621` refused is reused after all** · the two agent-owed waits raise "
        "the `waiting` standing, so a conversation nobody is waiting on wears the amber *Waiting "
        "on you* and joins `SideRail`'s `needingCount`, whose badge title is *N waiting on you*. "
        "⛔ `HO-092` §3's shape exactly: a count the person cannot clear",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives and D-036 (ea3cf258) deleted `waitIsAnotherAgents` and the
        # single line, so the two agent-owed waits are now two `case` arms of `standingOf` that
        # return `elsewhere`; the plant sends both to `waiting`.
        # three-surfaces-read-the-new-field.test.ts section 2 loops every non-person wait and
        # asserts the standing is not `waiting`, not amber, and not labelled Needs you (it is the
        # count a person cannot clear). Killed by `three-surfaces-read-the-new-field.test.ts`.
        [
            (STATE, "    case 'waiting-on-an-answer':\n      return 'elsewhere'\n", "    case 'waiting-on-an-answer':\n      return 'waiting'\n"),
            (STATE, "    case 'waiting-on-a-worker':\n      return 'elsewhere'\n", "    case 'waiting-on-a-worker':\n      return 'waiting'\n"),
        ],
    ),
    (
        "M2 · ⛔ **the person/agent split collapses toward the person** · every wait becomes a "
        "person's, so *it handed work out and that work is still open* — which asks NOBODY for "
        "anything — summons attention. ⚑ `621` §5.2's sentence, undone at the predicate rather "
        "than at the standing",
        [
            (
                STATE,
                "  return waiting === 'waiting-on-a-person'\n}",
                "  return waiting !== undefined\n}",
            )
        ],
    ),
    (
        "M3 · ⚠️ **…and it collapses the other way** · no wait is ever a person's, so a question "
        "passed up to a person reaches no in-conversation surface at all — `621` F2 restored, "
        "which is the half this dispatch closed",
        [
            (
                STATE,
                "  return waiting === 'waiting-on-a-person'\n}",
                "  return false\n}",
            )
        ],
    ),
    (
        "M4 · 🔴 **the amber comes back through the TONE** · the standing is right and the colour "
        "says *a person must act* anyway. ⛔ The back door `621` §5.2's argument does not mention "
        "and the one a copy-only repair would have left open",
        [(STATE, "  elsewhere: '',", "  elsewhere: 'waiting',")],
    ),
    (
        "M5 · ⚠️ **one of the two agent-owed waits is dropped** · *waiting on an answer* falls "
        "through to `idle`, which is the defect for the conversation that asked its giver about "
        "work it holds and has not been answered. ⛔ Two members, and a test that only ever "
        "planted the first would not notice",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-036 (ea3cf258) deleted `waitIsAnotherAgents`, but the rule survives: both
        # agent-owed waits must be read, and `waiting-on-an-answer` is read in `armFactsOf` as
        # `waitingOnAnAnswer`. Forcing it to false drops the answer arm to `idle` for the standing
        # and the one state. three-surfaces-read-the-new-field.test.ts expects `elsewhere` for it
        # and its partition test requires every wait to be in exactly one set. Killed by
        # `three-surfaces-read-the-new-field.test.ts`.
        [
            (STATE, "    waitingOnAnAnswer: facets.waiting === 'waiting-on-an-answer',", '    waitingOnAnAnswer: false,'),
        ],
    ),
    # ── B · the field reaches the three surfaces ──────────────────────────────────────────────
    (
        "M6 · ⛔ **the facet is dropped where the record is turned into facets** · `recordFacets` "
        "takes the wait and throws it away, so the RAIL goes back to reading five facets off "
        "`control` and says `idle` about every conversation whose work is out",
        # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006's seventh facet (`work`) is spread on the
        # next line; the row still throws the wait away and keeps the rest. Re-verified RED alone.
        # ⚑ W4.83 (F036) · re-anchored in place: the eighth facet (`owes`) is spread after `work`; the
        # row still throws the wait away and keeps the rest.
        [(STATE, "    ...(waiting ? { waiting } : {}),\n    ...(work ? { work } : {}),\n    ...(owes ? { owes } : {}),\n  })",
          "    ...(work ? { work } : {}),\n    ...(owes ? { owes } : {}),\n  })")],
    ),
    (
        "M7 · ⚠️ **the rail stops asking** · the row is built with no wait at all. ⚑ The prop is "
        "still declared and still passed, which is what makes this a different row from M6: the "
        "wiring is intact and the READ is gone",
        [
            (
                RAIL,
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006 passes a third argument, the work
                # (`theWorkIn`), one per line. The wait's slot is handed `undefined` rather than
                # dropped, so the work stays in its own slot: the READ of the wait is what goes.
                # Re-verified RED alone.
                "      record,\n      theWaitIn(props.waiting, record.sessionId),\n",
                "      record,\n      undefined,\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **the pane stops forwarding** · `facetInput` drops the prop, so the header pill, "
        "the shelf and the plate under the avatar all go back to `idle` — the three surfaces "
        "`HO-095` §5.1 names, from one object",
        # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006 forwards `work` after it, so the anchor ends
        # at the wait's own line. Same defect. Re-verified RED alone.
        [(PANE, "  waiting: props.waiting ?? undefined,\n", "")],
    ),
    (
        "M9 · ⚠️ **the pane forwards a wait that is not this conversation's** · a hard-coded "
        "value, so every conversation on screen claims the same one. ⛔ It is the shape a lookup "
        "keyed on the wrong id would take, and no assertion that only ever mounts ONE conversation "
        "can see it",
        [
            (
                PANE,
                "  waiting: props.waiting ?? undefined,",
                "  waiting: 'waiting-on-a-worker' as const,",
            )
        ],
    ),
    # ── C · the three absences ────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 **a conversation the reading does not cover is given an ANSWER** · *not in the "
        "reading* becomes *read, and nothing is outstanding*, which is "
        "`an-unenumerated-state-counts-as-success` with the enumeration on the wire. ⛔ `632` "
        "shipped three distinct absences at the band one surface over for exactly this reason",
        [
            (
                WAITS,
                "  if (row === undefined) return { known: 'not-in-the-reading' }",
                "  if (row === undefined) return { known: 'read', waiting: null }",
            )
        ],
    ),
    (
        "M11 · ⛔ **a reading that never landed is reported as one that did** · *nobody has "
        "looked* becomes *this conversation is not in the reading*, so a surface that later "
        "learns to tell the two apart would call a cold window a stopped conversation",
        [
            (
                WAITS,
                "  if (reading === null) return { known: 'nobody-has-looked' }",
                "  if (reading === null) return { known: 'not-in-the-reading' }",
            )
        ],
    ),
    (
        "M12 · ⚠️ **the plate goes back to the DOING word** · `plateWord` stops treating "
        "`elsewhere` as a state with a second fact to tell, so the drawer's bot prints `idle` "
        "directly above a paragraph that says work is out. ⛔ `250` found this once and `258` "
        "found it again; this is the third facet walking through the same gap",
        [
            (
                STATE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006 added `stalled` and `answered` and
                # the `return` now takes one standing per line. The row still drops `elsewhere`
                # alone. Re-verified RED alone.
                "    standing === 'scheduled' ||\n    standing === 'elsewhere' ||\n",
                "    standing === 'scheduled' ||\n",
            )
        ],
    ),
    # ── D · the precedence ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The renderer's own precedence chain was
        # replaced by the shared `agentStateArm` six-state order (D-017 R11); `inTheBackground` is
        # now resolved upstream of the switch that used to hold the swappable
        # `facets.detached`/`waitIsAnotherAgents` sibling checks, so there is no longer an adjacent
        # pair to reorder. The underlying claim (background still beats a worker-wait) also remains
        # true in current behaviour, so there is nothing to plant. Its anchor is left stale, so the
        # census records it retired.
        "M13 · ⚑ **detached work loses the slot to the wait** · a conversation holding a running "
        "`local_bash` AND work that is out says *waiting on a worker*, so the one fact with a "
        "Stop button behind it is the one the single slot drops. ⛔ {@link STANDINGS}' own rule, "
        "inverted",
        [
            (
                STATE,
                "    if (facets.detached) return 'background'\n    if (waitIsAnotherAgents(facets.waiting)) return 'elsewhere'",
                "    if (waitIsAnotherAgents(facets.waiting)) return 'elsewhere'\n    if (facets.detached) return 'background'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row's own defect is now the shipped
        # decision. `three-surfaces-read-the-new-field.test.ts` §4 explicitly asserts `standingOf({
        # ...base, scheduled: true })` (base includes `waiting: 'waiting-on-a-worker'`) is
        # `'scheduled'`, with the comment: "work handed out is no state of the agent's (05 rule 5),
        # so it only refines an idle plate — below the background AND the schedule, which each are."
        # That is exactly M14's claimed defect, now the intended D-017 R11 order. Its anchor is left
        # stale, so the census records it retired.
        "M14 · ⚠️ **a schedule outranks another agent working now** · the conversation says "
        "*scheduled* while Ada is mid-turn on its work. ⛔ Something happening NOW loses the slot "
        "to something that has not started, which is the rule `258` settled between the two rows "
        "above it",
        [
            (
                STATE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006 gave `scheduled` its own line (the
                # new `stalled` and `answered` follow it). The row swaps the same two lines, so a
                # schedule again outranks another agent working now. Re-verified RED alone.
                "    if (waitIsAnotherAgents(facets.waiting)) return 'elsewhere'\n    if (facets.scheduled) return 'scheduled'\n",
                "    if (facets.scheduled) return 'scheduled'\n    if (waitIsAnotherAgents(facets.waiting)) return 'elsewhere'\n",
            )
        ],
    ),
    # ── E · the words ─────────────────────────────────────────────────────────────────────────
    (
        "M15 · ⛔ **the row stops saying WHICH wait** · the rail prints the bare enum `elsewhere`, "
        "so *it handed work out* and *it asked and nobody answered* become one word — the "
        "distinction `waiting: permission` keeps for the needing family and this one would lose",
        [
            (
                STATE,
                "    return facets.waiting === undefined ? standing : WORK_STATE_WORD[facets.waiting]",
                "    return standing",
            )
        ],
    ),
    (
        "M16 · ⚠️ **the pill says `Idle` again** · the label, and only the label, goes back to the "
        "word the person photographed. ⛔ Two members of the vocabulary then share one word, which is "
        "a vocabulary a person cannot read the difference in",
        [(STATE, "  elsewhere: 'Waiting on another agent',", "  elsewhere: 'Idle',")],
    ),
    (
        "M17 · 🔴 **the screen reader is told nothing** · the sentence stops at *brobot — idle, "
        "live*, which leaves the one person who cannot see the pill or the plate with the exact "
        "impression this dispatch exists to remove. ⚑ `250` and `258` each wrote this row for the "
        "facet before it",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives: the screen reader must be told the wait. UI-008 (c37e0fd1)
        # changed the line to `parts.push(waitSummonsAPerson(input.waiting) ? NEEDS_YOU :
        # WORK_STATE_WORD[input.waiting])`, so the plant replaces that whole push with an empty
        # string. three-surfaces-read-the-new-field.test.ts asserts `after.read` is 'brobot — idle,
        # waiting on a worker' and the person case 'brobot — idle, live, needs you'; both break.
        # Killed by `three-surfaces-read-the-new-field.test.ts`.
        [
            (STATE, '    parts.push(waitSummonsAPerson(input.waiting) ? NEEDS_YOU : WORK_STATE_WORD[input.waiting])', "    parts.push('')"),
        ],
    ),
    (
        "M18 · ⛔ **v2.3 is given a word it does not have** · `elsewhere` leaves the hole list, so "
        "the projection's *what this design cannot say* count silently drops one — and the "
        "measurement `one-word-and-what-it-drops.test.ts` exists to keep goes quiet about the "
        "third state this product added because a one-word surface was wrong",
        [
            (
                PROJECTION,
                "export const V23_HOLES: readonly Standing[] = ['background', 'scheduled', 'elsewhere']",
                "export const V23_HOLES: readonly Standing[] = ['background', 'scheduled']",
            )
        ],
    ),
]
