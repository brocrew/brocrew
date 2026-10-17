#!/usr/bin/env python3
"""
151 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` selects which vitest project the runner uses: `node` (runtime + desktop) or `dom`.

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run, and `mutate.sh` refuses rather than reporting a green if one of
them stops matching.

⛔ **The one that matters most is M33.** This ticket's whole risk is that "stop showing a page
surface in the rail" quietly becomes "delete the page surface". M33 deletes it, and the assertion
that must catch that is the one in `closed-rail.dom.test.ts`'s last describe block.

🔴 **THREE ANCHORS WERE CORRECTED IN PLACE BY `421`, and the RED each row recorded was measured
against the OLD text.** ⛔ The census reads its verdicts out of `mutations.txt` and never re-checks
them against the anchors, so a corrected row keeps a verdict it never earned — which is why each of
the three carries the suffix in its label, and why this table now reads `partial-or-invalid`.

- **M15** · `421` made the plate's `ended` the ROW's answer rather than the literal `true`
  (HO-023 §2.3: a conversation this app is running must never be drawn as ended). Same defect, same
  kill; only the surrounding text moved.
- **M21** · the anchor became NON-UNIQUE rather than absent. `421` gave the rail a second section
  built from the same three elements, so the bare `<small>` tag matched twice; it is now spelled
  with the closed row's own indentation.
- **M27** · ⛔ **it had been retired since `154`** — which put a paragraph between the `for` and the
  `if` it anchors on — so the one row protecting *"a running conversation is not offered for
  reopening"* protected nothing for a hundred dispatches, and `418` then measured that exact claim
  being made about conversations no window holds. `421` re-aimed it at the same `continue`.

⚑ **All three were applied ALONE and watched go RED** against `closed-threads.test.ts` (M15, M27)
and `closed-rail.dom.test.ts` (M21), and restored from bytes. ⚠️ **M3, M4 and M35 were already
retired at `43b47b2` and are left alone** (`301` §5): they are another dispatch's evidence and no
part of `421`.
"""

import sys
from pathlib import Path

CLOSED = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
CLOCK = "apps/desktop/src/renderer/src/lib/clock.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
LIB = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
DBSTORE = "apps/desktop/src/main/db/session-store.ts"
CONVERSATION_LIST = "apps/desktop/src/renderer/src/lib/conversation-list.ts"

# The rail's closed row, whole — deleting it is how "three elements" becomes "no elements".
ROW_PLATE = '            <AgentState size="compact" v-bind="row.facets" :label="row.label" />\n'

# (name, suite, [(file, old, new), ...])
# ⚑ **504 · `describeRow`'s own line, spelled with the line above it.**
#
# ⛔ **The bare `    hasTranscript: row.has_events !== 0,` stopped being UNIQUE**, not absent: `504`
# gave `conversationsInProject` the same field off the same column, twelve spaces in, and a
# four-space needle is a substring of a twelve-space line. ⚠️ The row's DEFECT and its kill are
# unchanged — `322`'s fourth case, where you go looking for deleted text and the text is still
# there, twice.
DESCRIBE_ROW_TRANSCRIPT = "    updatedAt: row.updated_at,\n    hasTranscript: row.has_events !== 0,"

MUTATIONS = [
    # ---- §2 · one gesture, three outcomes -------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row planted in
        # `closed-threads.ts`, which D-017b deleted. Read presses and the closed/open split are
        # gone, and the D-017b commit says 'no Reopen/Read/Take-over presses', so there is no button
        # for an empty-pane Read to offer. The rewritten `closed-threads.test.ts` now tests
        # `conversationList` and no longer contains this row's subject. Its anchor is left stale, so
        # the census records it retired.
        "M1 · a row we hold NOTHING of is offered Read — 106's button onto an empty pane",
        "node",
        [(CLOSED, "  return row.hasTranscript ? 'read' : null", "  return 'read'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Its file `closed-threads.ts` was
        # deleted by D-017b, and with it 118's rule that a refused row offers no reopen. D-017b has
        # no open/closed split and no Reopen press, so 'every row offers a reopen' is no longer a
        # state the code can be in. The one list draws the host's one state (D-017 R11). Its anchor
        # is left stale, so the census records it retired.
        "M2 · the refusal is ignored and every row offers a reopen (118's rule gone)",
        "node",
        [(CLOSED, "  if (row.refusal === null) return 'reopen'", "  return 'reopen'\n  if (false)")],
    ),
    (
        "M3 · an inert row is a BUTTON again — the control that cannot act (106)",
        "dom",
        [(RAIL, "  return row.gesture !== null && !row.reopening", "  return row.gesture !== null")],
    ),
    (
        "M4 · a row stays pressable while its reopen is in flight (102's double-press)",
        "dom",
        [(RAIL, "  return row.gesture !== null && !row.reopening", "  return !row.reopening")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row planted deleting `if
        # (row.reopening) return`, the rail's guard against a second Reopen press. D-017b removed
        # that press and the `reopening` field: a rail row is now a single `select` emit with no
        # in-flight state, and no `row.reopening` remains in SideRail.vue. The commit says 'no
        # Reopen / Take it over / Read the recording presses: one press, "Open the conversation"'.
        # Its anchor is left stale, so the census records it retired.
        "M5 · the press guard goes, so a second click double-reopens",
        "dom",
        [(RAIL, "  if (row.reopening) return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row planted swapping the read
        # gesture's emit (`readRecorded` to `reopen`) in the rail's press handler. D-017b deleted
        # the reading-only pane and the `row.gesture` / `readRecorded` path, and the card says 'no
        # reading-only pane, no Reopen / Take it over / Read the recording presses'. The rail now
        # has one press, `emit('select', row.sessionId)`. Its anchor is left stale, so the census
        # records it retired.
        "M6 · a press on a readable row reopens it instead of reading it",
        "dom",
        [
            (
                RAIL,
                "  if (row.gesture === 'read') emit('readRecorded', row.sessionId)",
                "  if (row.gesture === 'read') emit('reopen', row.sessionId)",
            )
        ],
    ),
    (
        "M7 · the rail stops forwarding Read to the screen (118, the hop nothing crossed)",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives renamed: the old `readRecorded` forward is now the
        # rail row's one `@click=\"emit('select', row.sessionId)\"` (SideRail.vue line 1077, the
        # only such line; the palette's `emit('select', action.sessionId)` at line 666 is a
        # different spelling and is left alone). Deleting it draws a row button that emits nothing,
        # which is the same 'hop nothing crossed' defect. Both killers are dom-suite files already
        # in mutate.sh's DOM_FILTERS (`closed-rail`, `closed-threads`), and the original M7 comment
        # in `closed-threads.dom.test.ts` names this hop. Keep the label text as is (it keys the
        # record
        [
            (RAIL, '          @click="emit(\'select\', row.sessionId)"', ''),
        ],
    ),
    # ---- §1 · the one fact, and the order it is chosen in ----------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row planted in
        # `closed-threads.ts`, which D-017b deleted along with `kept-open.ts` (796 lines removed),
        # so its target file no longer exists. The 'failed reopen outranks the ordinary line' rule
        # went with the closed-thread rows and the Reopen press; no `row.failure` or 'reopening…'
        # note remains in conversation-list.ts or SideRail.vue. Its anchor is left stale, so the
        # census records it retired.
        "M8 · a failed reopen is outranked by the row's ordinary line (100)",
        "node",
        [
            (
                CLOSED,
                "  if (row.failure !== null && !row.reopening) return { note: row.failure, title: row.failure }\n  if (row.reopening) return { note: 'reopening…', title: '' }",
                "  if (row.reopening) return { note: 'reopening…', title: '' }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same file and same removed subject as
        # M8: `closed-threads.ts` is deleted and the stale-failure-under-a-reopen-in-flight line has
        # no successor. D-017b's one Conversations list has no reopen-in-flight state and no failure
        # line to leave stale. Its anchor is left stale, so the census records it retired.
        "M9 · a reopen in flight shows the stale failure under it instead of saying so",
        "node",
        [
            (
                CLOSED,
                "  if (row.failure !== null && !row.reopening) return",
                "  if (row.failure !== null) return",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** A retry that is painted as a failure
        # needs a reopen in flight, and D-017b removed the Reopen press and its pending/failed flags
        # from the rail. The file `closed-threads.ts` is deleted, and the rewritten
        # `closed-rail.dom.test.ts` has no reopen-retry test. Its anchor is left stale, so the
        # census records it retired.
        "M10 · a retry is still painted as a failure while it is trying again",
        "node",
        [(CLOSED, "      failed: Boolean(failure) && !reopening,", "      failed: Boolean(failure),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The inert-row explanation (106) was a
        # sentence about why a closed row could not be reopened. D-017b drops every sentence about
        # whether a process runs (`05` rule 5) and every reopen refusal, and it deletes
        # `closed-threads.ts`. The subject was removed on purpose, so there is no plant left to
        # anchor. Its anchor is left stale, so the census records it retired.
        "M11 · an inert row says nothing about why it is inert (106)",
        "node",
        [
            (
                CLOSED,
                "      note: 'nothing of it was recorded, so there is nothing to open',",
                "      note: '',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** This row planted the refusal half of
        # an inert row's hover in `closed-threads.ts`, which no longer exists. D-017b has no inert
        # rows and no refusal text, because each row draws the host's one state and every row is the
        # same control. The rewritten tests pin the row's own state, not a refusal. Its anchor is
        # left stale, so the census records it retired.
        "M12 · the refusal is dropped from the inert row's hover — the other half lost",
        "node",
        [
            (
                CLOSED,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 701 — the hover gained a clause after the refusal
                # (`699` GAP-2's sentence, on the one row whose face is spoken for), so the title is
                # two lines now; the defect planted is unchanged: the refusal leaves the hover.
                "        `${row.refusal ?? ''} — and none of its messages are here, so there is nothing to read` +\n",
                "        '' +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** 'A row that cannot reopen says why
        # (086)' belonged to the closed list. D-017b has one Conversations list with no reopen, so
        # no row is refused and none needs to say why. The file is deleted and `conversationList`
        # has no such branch. Its anchor is left stale, so the census records it retired.
        "M13 · a row that cannot reopen dates itself instead of saying why (086)",
        "node",
        [(CLOSED, "  if (row.refusal !== null) return { note: row.refusal, title: row.refusal }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 200px hover sentence was the
        # refusal text of the deleted closed-row builder in `closed-threads.ts`. D-017b removed all
        # refusal sentences, and the row now shows a label, a directory (or nothing) and the host's
        # state facets. There is no sentence left to reach a hover. Its anchor is left stale, so the
        # census records it retired.
        "M14 · the whole sentence stops reaching the hover, so 200px is all a reader gets",
        "node",
        [
            (
                CLOSED,
                "  if (row.refusal !== null) return { note: row.refusal, title: row.refusal }",
                "  if (row.refusal !== null) return { note: row.refusal, title: '' }",
            )
        ],
    ),
    # ---- §1 · the plate, and the label ------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** This row's 'plate claims still live'
        # defect was a hand-invented state in `closed-threads.ts` (the state 086 forbids), and that
        # file is deleted. In D-017b the plate is drawn from the host's own state (`state:
        # row.state`), so the code has no place where the rail can invent one. A live-never-ended
        # guard exists instead in `a-live-conversation-is-never-drawn-as-ended.dom.test.ts`. Its
        # anchor is left stale, so the census records it retired.
        "M15 · the plate claims the conversation is still live (the invented state 086 forbids) "
        "⚑ ANCHOR CORRECTED IN PLACE BY 421",
        "node",
        [(CLOSED,
          "        ended: row.running === 'not-running',\n",
          "        ended: false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** An ERRORED row flattened to closed had
        # two arms in the old builder. D-017b's `conversationList` no longer reads `status`, and the
        # host state has no errored arm to flatten. The file is deleted and the subject is gone with
        # the split it depended on. Its anchor is left stale, so the census records it retired.
        "M16 · an ERRORED row is flattened into an ordinary closed one",
        "node",
        [(CLOSED, "        status: row.status,\n", "        status: 'idle',\n")],
    ),
    (
        "M17 · a conversation with no directory gets a blank fact instead of no fact "
        "⚑ ANCHOR CORRECTED IN PLACE BY 449",
        "node",
        # ⚑ **Re-anchored by `449`, not retired** (142's rule). ⛔ The label used to be
        # `basenameOf(row.cwd) || row.sessionId` and is now the IDENTITY, which always answers — so
        # the `||` this row was about moved, with the folder, onto `place`. ⚠️ **The defect it puts
        # back is the same one**: a row whose directory cannot be named draws an empty string where
        # it should draw nothing, which on the rendered row is a trailing separator with nothing
        # after it.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The subject survives in
        # `conversation-list.ts`: a conversation with no directory must give no place, not a blank
        # one, and the row must say WHO and simply stop. Dropping the `|| null` lets
        # `basenameOf('')` hand a blank string through, which is exactly the blank-fact defect. The
        # anchor occurs once.
        [
            (CONVERSATION_LIST, '      place: basenameOf(row.cwd) || null,', '      place: basenameOf(row.cwd),'),
        ],
    ),
    (
        "M18 · the person's avatar goes — the one thing he asked for by name",
        "dom",
        # The conversation-row avatar is its compact AgentState plate. Removing the line must fail
        # the DOM existence assertion, not merely throw while the harness reads a missing node.
        [
            (RAIL, '          <AgentState size="compact" v-bind="row.facets" :label="row.label" />\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** 'The closed rows lose the open rows'
        # grid' compared two lists, and D-017b merged them into one `.rail-conversations` list with
        # a single `.rail-item` grid rule, so there are no two lists left to drift apart. The
        # commit's 'one Conversations list' line is the reason. Any plant on that single rule is a
        # different defect (the 24px plate column), which no test pins. Its anchor is left stale, so
        # the census records it retired.
        "M19 · the closed rows lose the open rows' grid, so the two lists drift apart "
        "⚑ ANCHOR CORRECTED IN PLACE BY 421",
        "dom",
        # ⚠️ **421 gave the rule a third selector** — the rail's new *"Running · nobody watching"*
        # section draws the same three elements — so the anchor gained a line. The replacement still
        # removes the CLOSED rows and only them, which is what this label is about.
        [
            (
                RAIL,
                ".rail-conversations .rail-item,\n[data-cy='closed-threads'] .rail-item,\n[data-cy='rail-running-unwatched'] .rail-item {",
                ".rail-conversations .rail-item,\n[data-cy='rail-running-unwatched'] .rail-item {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** An inert row that looks pressable
        # needs a difference between inert and pressable rows. D-017b makes every row the same
        # control, and `closed-rail.dom.test.ts` now asserts 'every row is the same control' (cursor
        # is not 'default'). The inert branch and its CSS are deleted. Its anchor is left stale, so
        # the census records it retired.
        "M20 · an inert row still looks pressable",
        "dom",
        [(RAIL, ".rail-item.inert {\n  cursor: default;\n}", ".rail-item.inert {\n  cursor: pointer;\n}")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** A failed reopen painted as a fault
        # needs a Reopen press and a failure flag on the row. D-017b removed the press ('no
        # Reopen/Read/Take-over presses'), the flag and the fault styling from the rail. The old
        # anchor is absent (count 0) and no equivalent exists. Its anchor is left stale, so the
        # census records it retired.
        "M21 · a failed reopen is not painted as a fault ⚑ ANCHOR CORRECTED IN PLACE BY 421",
        "dom",
        # ⚠️ **Spelled with the CLOSED row's own indentation**, because 421 gave the rail a second
        # section built from the same three elements and the bare tag now matches twice
        # (`correct-a-stale-mutation-anchor-dont-retire-it`, the fourth case). The row is about the
        # closed list's small, which is the one this table's dom file presses.
        # ⚑ **Re-anchored a SECOND time, by `449`** — prettier broke the tag across four lines when
        # the row gained `data-place`. ⚠️ The closed list's own indentation is still what tells it
        # from the running section's identical `<small>` two hundred lines up.
        [(RAIL,
          '              <small\n                :class="{ err: row.failed }"\n                :title="row.title"',
          '              <small\n                :title="row.title"')],
    ),
    # ---- §2 · the cancel, and what settles a reopen ------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** 102's wedge was a reopen in flight
        # with no cancel. D-017b removed reopen from the rail entirely, so there is nothing to wedge
        # and nothing to cancel. The old anchor no longer occurs in `SideRail.vue`. Its anchor is
        # left stale, so the census records it retired.
        "M22 · the cancel is gone — 102's wedge, back, with no way out but quitting",
        "dom",
        [(RAIL, '                  v-if="row.reopening"\n', '                  v-if="false"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'reopening…' flag and its settle
        # handler were removed with the Reopen press by D-017b. No row can say 'reopening…' any
        # more, so a flag that never clears cannot be planted. The old anchor is absent. Its anchor
        # is left stale, so the census records it retired.
        "M23 · a settled reopen never clears the flag, so the row says 'reopening…' for ever",
        "dom",
        [
            (
                RAIL,
                "    reopening.value = { ...reopening.value, [sessionId]: false }",
                "    void sessionId",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** A failed reopen reaching the pressed
        # row (100) depends on a per-row reopen action, which D-017b deleted ('no
        # Reopen/Read/Take-over presses'). The list-level `conversations-error` for an unreadable
        # list is a different subject, covered by re-anchored M29. Its anchor is left stale, so the
        # census records it retired.
        "M24 · a failed reopen never reaches the row it was pressed on (100)",
        "dom",
        [
            (
                RAIL,
                "    if (failure !== null) failures.value = { ...failures.value, [sessionId]: failure }",
                "    void failure",
            )
        ],
    ),
    # ---- §4 · the count, and hideOpen --------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The old 'count answers 0 before it has
        # looked' subject was the closed-list summary and its looked/not-looked state, which are
        # gone. The only count left is `openCount = rows.value.length`, shown as `{{ openCount ||
        # 'Recent' }}`, and the zero state is not a wrong number in a real one's clothes.
        # `command-palette.ts`'s `looked`/`listError` feed a searched-note, not a count. Its anchor
        # is left stale, so the census records it retired.
        "M25 · the count answers 0 before it has looked — a wrong number in a real one's clothes",
        "dom",
        [
            (
                RAIL,
                "  closedLooked.value ? closedRows.value.length : null,",
                "  closedRows.value.length,",
            )
        ],
    ),
    (
        "M26 · the summary counts what was FETCHED, not what a reader would find",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The summary must count
        # what a reader would find (the folded rows) and not what was fetched. Today `openCount` is
        # `rows.value.length`, and counting `hostResumable.value.length +
        # hostUnresumable.value.length` instead plants the FETCHED-not-found defect, because
        # `conversationList` filters and dedupes (154 and 214). The anchor occurs once and both refs
        # exist in `SideRail.vue`.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — 4c1718d7 (the side menu split) deleted `openCount`; the count a reader finds is
        # now each section's header `{{ section.rows.length }}`, so the rule (the summary counts the
        # rows drawn, not what the host list returned) survives. The plant counts the two fetched
        # host lists instead; in the template the refs are auto-unwrapped, so it is
        # `hostResumable.length`, not `.value.length` (which would be undefined and a TypeError).
        # Killed by `closed-rail.dom.test.ts`.
        [
            (RAIL, 'section.rows.length', 'hostResumable.length + hostUnresumable.length'),
        ],
    ),
    (
        "M27 · a running conversation is offered for reopening again (090) "
        "⚑ ANCHOR CORRECTED IN PLACE BY 421",
        "dom",
        # ⛔ **Retired since `154`, which put a paragraph between the `for` and the `if`** — so the
        # one row protecting *"a conversation this window is already running is not offered for
        # reopening"* has protected nothing for a hundred dispatches, and `418` then measured that
        # claim being made about conversations no window holds. ⚑ `421` re-aims it at the SAME
        # `continue`, spelled through the push that follows so it names the resumable half alone
        # (the other half carries the identical line). The rule is unchanged: `hideOpen` answers
        # *"do I already have this on screen"*, and 421 kept it answering exactly that.
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 added `keptOpen` to the resumable half's push; the anchor now reads it, and the row still deletes the `hidden` skip. The DEFECT this row plants is unchanged.
                # ⚑ **Re-anchored again by `449`**, which put `profileId` in this push so a row can
                # say who is in it. The rule is untouched.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The dedupe that replaced closed-threads.ts's `hideOpen` skip is the `if
        # (drawn.has(host.sessionId)) continue` in SideRail.vue `rows`, which stops the host's row
        # from being drawn for a conversation this window already holds. With it deleted, the host's
        # row for a held id overwrites the record's row in `drawn`, so the conversation is described
        # again from the host's list (its cwd basename, not the held record's folder) and the test's
        # `held-here` assertion fails. The row's suite must change from `node` to `dom` in
        # mutations.py, because the killer is a dom-project file already covered by the harness
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d96cd5232 added provider-limit display before shownHere; omit only the original duplicate-conversation guard.
            (RAIL, "    if (drawn.has(host.sessionId)) continue\n    const facets = facetsOfState(host.state)\n", "    const facets = facetsOfState(host.state)\n"),
        ],
    ),
    (
        "M28 · …and the same, on the unresumable half this ticket widened it to",
        "dom",
                # ⚑ **Re-anchored by 222**, which added `lastEnding` to this push. The defect is unchanged —
                # `hideOpen` stops reaching the unresumable half — and the row is CARRIED into 222's
                # own table so it is genuinely re-run rather than merely made applicable again.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — D-017b folded both host halves into one list and one dedupe line
        # (SideRail.vue `rows`, `if (drawn.has(host.sessionId)) continue`), so M27 and M28 now share
        # a line. The plant keeps the dedupe for the resumable half and drops it only for
        # hostUnresumable ids, so the held unresumable conversation's record row is replaced by the
        # host's row (Map overwrite, not a second row). The row's suite changes from node to dom,
        # and today's fixture cannot see this plant: it needs a one-line sharpening (below).
        [
            (RAIL, '    if (drawn.has(host.sessionId)) continue\n', '    if (drawn.has(host.sessionId) && !hostUnresumable.value.some((one) => one.sessionId === host.sessionId)) continue\n'),
        ],
    ),
    (
        "M29 · a list that could not be READ renders as an empty one",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The subject survives: a
        # list that could not be READ must say so and not render as an empty list. In `SideRail.vue`
        # the `conversations-error` paragraph is gated by `v-if="listError"`, and making the gate
        # `false` renders the failure as an empty list. The anchor occurs once at 8-space indent.
        [
            (RAIL, '        <p v-if="listError" class="rail-empty err" data-cy="conversations-error">', '        <p v-if="false" class="rail-empty err" data-cy="conversations-error">'),
        ],
    ),
    # ---- the clock ---------------------------------------------------------------------------------
    (
        "M30 · 'ago' loses its seconds, so everything just closed reads as 0m",
        "node",
        [(CLOCK, "  if (seconds < 60) return `${seconds}s ago`\n", "")],
    ),
    (
        "M31 · a clock ahead of ours reports a negative age",
        "node",
        [
            (
                CLOCK,
                "  const seconds = Math.max(0, Math.round((now - at) / 1000))",
                "  const seconds = Math.round((now - at) / 1000)",
            )
        ],
    ),
    # ---- §3 · the sentences ------------------------------------------------------------------------
    (
        "M32 · the refusal goes back to jargon — the sentence the person could not parse",
        "node",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # refusal for a conversation found in the person's own provider folder must stay in plain
        # words, not the old 'provider home' jargon. D-017b only reworded it from 'a reopen would
        # start ...' to 'a message here would start ...', so the old anchor is gone and the plant
        # must target the current block in whyNotResumable.
        [
            (DBSTORE, "    return (\n      `one of your own ${provider} conversations, found in ${provider}'s own folder — BroCrew can ` +\n      `read it here, but a message here would start ${provider} in BroCrew's own folder, where ` +\n      'this conversation is not'\n    )", "    return 'it was found in your own provider home, which this app only ever reads'"),
        ],
    ),
    (
        "M33 · …and it names the wrong provider, on every row",
        "node",
        [
            (
                DBSTORE,
                "  const provider = PROVIDER_NAME[row.provider as Provider]",
                "  const provider = PROVIDER_NAME.codex",
            )
        ],
    ),
    (
        "M34 · the never-started row goes back to naming a handshake nobody has heard of",
        "node",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # never-started row must say plainly that no turn was taken, not name a handshake. D-017b
        # changed only the tail ('nothing to reopen' became 'nothing to carry on from'), so the same
        # branch is planted at its new text.
        [
            (DBSTORE, "    ? 'no turn was ever taken in this one, so there is nothing to carry on from'", "    ? 'never started a turn — the provider never gave it an id'"),
        ],
    ),
    (
        "M35 · the unreadable-ref row does too",
        "node",
        [
            (
                DBSTORE,
                "    : 'we can no longer read where this conversation lives, so it cannot be reopened'",
                "    : 'the recorded provider id can no longer be read'",
            )
        ],
    ),
    (
        "M36 · the unresumable half stops saying whether we hold its messages "
        "⚑ ANCHOR CORRECTED IN PLACE BY 504",
        "node",
        [(DBSTORE, DESCRIBE_ROW_TRANSCRIPT, "    updatedAt: row.updated_at,\n    hasTranscript: false,")],
    ),
    (
        "M37 · …and says it backwards ⚑ ANCHOR CORRECTED IN PLACE BY 504",
        "node",
        [(DBSTORE, DESCRIBE_ROW_TRANSCRIPT,
          "    updatedAt: row.updated_at,\n    hasTranscript: row.has_events === 0,")],
    ),
    # ---- §4 · the deletion this ticket must not become ---------------------------------------------
    (
        "M38 · THE ONE THAT MATTERS · the reopen list is deleted rather than moved · killed by `closed-rail.dom.test.ts`",
        "dom",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41 (`712` F-4): the mount forwards the roster
                # (`:identities`) so the list names who a row reopens as; the defect planted is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # Sessions page must keep the recorded-conversations list, with its export and scan
        # controls, so that the change does not become a deletion. D-017b kept the band (now
        # 'Recorded conversations') and only slimmed the mount to `:identities` and `@open`, so the
        # planted deletion targets the new five-line mount.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · bcb7b529 moved the recorded-conversations band into its own column, so the mount is indented four spaces deeper; the plant still deletes the list instead of moving it.
            (LIB, "            <ResumableSessions\n              ref=\"reopenList\"\n              :identities=\"props.identities\"\n              @open=\"(sessionId) => emit('open', sessionId)\"\n            />", ""),
        ],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
