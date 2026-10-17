"""634 · Three sentences on screen that describe an older app.

⛔ **Ordered by `HO-095` §7's table — the three rows no other dispatch claimed.** ⚑ Each is a
sentence the app still said about itself that stopped being true when something shipped, which is
standing rule 8.1 — the same sweep `620` did for the `default` → `BroBot` rename, in the other
direction: not a renamed value, a renamed CONCEPT.

## 🔴 What each one was

 * **`Home · SOON` beside the two rows that replaced it.** ⚑ Its subtitle read *Dashboard across
   active projects*, and `606` moved that job to *Waiting on you* and *While you were away* —
   both drawn immediately above it (`EXT-008` §3, `HO-025` §2). ⛔ So the rail row named, from
   the rail, the two destinations beside it.
 * **`another caller can drive this`.** ⚠️ True, and written in this app's own vocabulary:
   `caller` is the `Caller` type. ⛔ `HO-092` §5: *"with nothing saying what that means for
   the person — whether he should expect the conversation to move, whether his own messages compete,
   whether it matters."*
 * **`Take it over and open it`.** 🔴 **REPORTED, not changed** — the label is HONEST (the press
   calls `store.claim` and then opens), and what is missing is a read-only path. `M6` and `M7`
   are the rows that keep both halves of that measured.

## The row groups

 * `M1`      ⛔ **the rail** — the stale subtitle comes back.
 * `M2`-`M5` ⚠️ **the glance and the paragraph** — the jargon returns, the surface spells its own
              copy again, and each sentence loses the clause that answers a person's question.
 * `M6`-`M8` 🔴 **the one that is a finding** — a read of a conversation still being written, a
              label that understates the press, and a press that does not do what its label says.

## ⚠️ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row removes the Home DESTINATION.** Five surfaces send a person there — `crumb-home`
   on the conversation header and the project page, the Library's Home button, the composer's and
   the pane's — so removing it is a navigation change across six components and a product
   decision, not a copy fix. ⚑ `634` reported it.
 * ⚠️ **No row makes the glance too LONG for its chip.** `ANOTHER_CALLER_IS_ON_IT` is 64
   characters and the header bar is 1200 px wide in every fixture this app has, so a swap would
   fit and record as a survivor — `a-mutation-that-changes-nothing-reports-as-a-survivor`.
   ⛔ `M5` takes the clause instead, which is the half a person actually loses.
 * ⚠️ **No row on `soon`.** It is still honest: every input `HomeSurface` is given is the demo
   seed's, so `front-door-words.ts`' *nothing unwired implies a working state* is unchanged.

## ⚑ WRITTEN, not run

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** No
`mutations.txt` exists at this HEAD and its absence is the honest state.
"""

from __future__ import annotations

RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
GRANTS = "apps/desktop/src/renderer/src/lib/standing-grants.ts"
THREADS = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
TAKING = "apps/desktop/src/renderer/src/lib/taking-over.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SESSIONINFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the rail ──────────────────────────────────────────────────────────────────────────
    (
        # The rail Home row, subtitle and Home surface are gone. No element remains for this
        # stale-subtitle defect; retain the absent anchor as retired.
        "M1 · ⛔ **the stale subtitle comes back** · Home tells a person it is the *dashboard "
        "across active projects* while the two rows drawn immediately above it ARE that dashboard "
        "— `606` split the job in two (`EXT-008` §3) and the sentence outlived the split. ⚠️ **It "
        "is a `says` and therefore clipped at 94 px**, which is the narrowest column in the rail: "
        "a person reads *Dashboard across active pro…* (`531`)",
        [
            (
                RAIL,
                "            <strong>Home</strong>\n",
                "            <strong>Home</strong>\n"
                '            <small class="says" title="Dashboard across active projects"\n'
                "              >Dashboard across active projects</small\n"
                "            >\n",
            )
        ],
    ),
    # ── B · the glance and the paragraph ──────────────────────────────────────────────────────
    (
        # The header’s automatic-work glance and its constant are gone. There is no sentence left to
        # mutate, so retain the absent anchor as retired.
        "M2 · ⚠️ **the jargon returns** · the glance says *another caller can drive this* — true, "
        "and in this app's own vocabulary (`caller` is the `Caller` type). ⛔ `HO-092` §5's whole "
        "complaint: a true sentence in words nobody outside the codebase has been given, telling "
        "a person nothing they can act on",
        [
            (
                GRANTS,
                "export const ANOTHER_CALLER_CAN_SEND_HERE = 'it can start working without you'",
                "export const ANOTHER_CALLER_CAN_SEND_HERE = 'another caller can drive this'",
            )
        ],
    ),
    (
        "M3 · ⛔ **the surface spells its own tooltip again** · the header carries a copy of the "
        "paragraph instead of the module's, which is the state `634` found: one fact with FOUR "
        "spellings, the two a reader meets first owned by no module. ⚑ `169` §1 applied to copy, "
        "and the drift shows up as the two sentences disagreeing after the next correction",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The header no longer renders the paragraph (ae07008f), but the
        # one-fact-one-spelling rule survives on its last surface: SessionInfo.vue's note renders
        # `{{ ANOTHER_CALLER_MAY_REACH_IN }}`. press-read-and-a-word.test.ts requires that exact
        # mustache in the rendered Info source (twice) and counts literal copies across components,
        # so replacing it with a typed-out sentence turns it red. The label's header wording is
        # stale; the plant is Info's note. Killed by `press-read-and-a-word.test.ts`.
        [
            (SESSIONINFO, '              {{ ANOTHER_CALLER_MAY_REACH_IN }}\n', '              This conversation was commissioned by something else — usually an agent, through BroBot2’s own tools.\n'),
        ],
    ),
    (
        "M4 · ⚠️ **the paragraph stops answering the second question** · *whether his own messages "
        "compete* goes unanswered again, which is one of the three things `HO-092` §5 named — and "
        "it is the one a person acts on while deciding whether to keep typing",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The clause 'Your own messages are
        # unaffected — they go, or wait for a running turn…' survives in
        # ANOTHER_CALLER_MAY_REACH_IN. Re-verified RED alone.
        [
            (GRANTS, " Your own messages are ' +\n  'unaffected — they go, or wait for a running turn, exactly as they would anyway.'", "'"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the glance sentence this row weakens: "the header-only grant titles and the 'it
        # can start working without you' glance"; `ANOTHER_CALLER_CAN_SEND_HERE` no longer exists.
        # The consequence-bearing clause that remains is in ANOTHER_CALLER_MAY_REACH_IN, already
        # guarded by 634 M4. Its anchor is left stale, so the census records it retired.
        "M5 · ⚠️ **the glance states a STATE and not a consequence** · *it can start working* "
        "describes the conversation and says nothing about the reader, which is the half that "
        "answers *whether it matters*. ⛔ The sentence stays true and stops being useful, which is "
        "the exact failure mode `HO-092` §5 is about",
        [
            (
                GRANTS,
                "export const ANOTHER_CALLER_CAN_SEND_HERE = 'it can start working without you'",
                "export const ANOTHER_CALLER_CAN_SEND_HERE = 'it can start working'",
            )
        ],
    ),
    # ── C · the one that is a finding ─────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):**
        # `apps/desktop/src/renderer/src/lib/closed-threads.ts` (and its
        # `recordingGesture`/'take-over' arms) was deleted in D-017b (796 lines removed in the
        # diffstat). Commit: 'no Reopen / Take it over / Read the recording presses: one press,
        # "Open the conversation"'. Its anchor is left stale, so the census records it retired.
        "M6 · 🔴 **a read of a conversation still being written** · the live arm falls through to "
        "the recording table, so a person is offered *Read the recording* over a transcript that "
        "is still growing — ⛔ **the product gap `634` reported, closed the wrong way.** ⚠️ "
        "`gestureFor`'s own docblock refuses exactly this, and the refusal is a DECISION rather "
        "than an omission — which is why the row exists and the repair did not",
        [
            (
                THREADS,
                "    return row.running === 'unwatched' ? 'take-over' : null",
                "    return row.running === 'unwatched' ? 'take-over' : recordingGesture(row)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'Take it over and open it' fork no
        # longer exists: `taking-over.ts` now exports only `OPEN_THE_CONVERSATION`,
        # `TAKE_IT_OVER_TO_ANSWER_HERE`, `ANSWERED_IN_THE_OTHER_WINDOW`,
        # `ANSWERED_ONCE_A_WINDOW_TAKES_IT` and `OPEN_IN_ANOTHER_WINDOW`, and the row press asks the
        # new `look` door, which does not claim. Commit: 'one press, "Open the conversation"'. Its
        # anchor is left stale, so the census records it retired.
        "M7 · ⛔ **the label understates the press** · the row says *Open the conversation* over a "
        "press that CLAIMS first — `RuntimeHost.claimSession`, `336`'s door — so a person who "
        "wanted to look has adopted a conversation and been told nothing. ⚑ `403` chose the fork "
        "precisely to stop this, and it is the defect `634` §3 measured the label against",
        [
            (
                TAKING,
                "  return held ? 'Open the conversation' : 'Take it over and open it'",
                "  return 'Open the conversation'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row press `takeOver` that claimed
        # and then navigated is gone: `RuntimeScreen.vue`'s `openConversation` now goes through
        # `store.look`, and a press no longer adopts anything (commit: 'Pressing it asks the host's
        # new look door: attached if this window holds it, claimed if it runs with no owner, else a
        # recorded hand-over'). The only surviving `store.claim(...)` call there is
        # `takeOverForTheQueue`, the queue's own press, which is table 434's. Its anchor is left
        # stale, so the census records it retired.
        "M8 · 🔴 **…and the other direction: the press stops doing what the label says** · "
        "`takeOver` navigates without claiming, so the row promises an adoption it does not "
        "perform and the conversation stays unowned — ⚠️ the pane then offers controls that the "
        "host refuses, which is `106` arriving one press later",
        [
            (
                SCREEN,
                "    await store.claim(sessionId)\n  } catch (cause: unknown) {\n    say(readableError(cause))",
                "    await Promise.resolve()\n  } catch (cause: unknown) {\n    say(readableError(cause))",
            )
        ],
    ),
]
