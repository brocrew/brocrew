"""701 · What a quit left open, on screen — `692` F-a/F-b, `699` GAP-1/GAP-2, `690`'s `retracted`
and `700`'s person's-queue gap.

⚑ **The PM's §1:** since `692` a restart keeps conversations open with nothing running — and a
person's press on one STARTED its provider (F-a), and there was no Close for one (F-b). ⚑ Now the
press opens a pane — its transcript and a composer — and the FIRST SEND starts it; the pane's End
conversation reaches the host's no-start Close. **§2:** the Work tab says what is true of a holder
the quit left open, live on the tab and as-at-the-time on the report (`699` GAP-1, F-5); a closed row
says *closed because BroBot did not finish quitting* after a quit that did not finish (`699` GAP-2);
a `retracted` held notice is drawn quiet, like every ending, and the export prints its reason; the
person's queue draws a marked ask's sentences and does not dim its refusals (`700` §5).

## 🔴 What has to be killable

 * `M1`–`M13` 🔴 **F-a · the press and the first send**: the rail's press back to the Reopen; two
   starts of one conversation; the words lost on a refused start or a refused send; the refusal
   unsaid; the person never taken there; the draft not held; the pane's composer never `starting`,
   its send and its End dropped; a card asked before the quit left live; the failure unsaid; End
   live while a start is in the air.
 * `M14`–`M27` 🔴 **F-a/F-b · the routes**: the place drawing the launcher, or not reserved; the four
   surfaces' press, the forest's, a refused take-over and the host's own question each back to the
   start; the drafts of a conversation the quit left open swept; End never reaching the host; the
   row never drawn active; the palette's *Reopen*; the Sessions page calling it closed; the rail's
   hover saying the press starts it.
 * `M28`–`M37` 🔴 **`699` GAP-1**: the cause conjunct and the `=== true` dropped; the words never
   said; the reading moment ignored or swapped at each of the three readers; the hover gone; the
   snapshot's words and the live word changed.
 * `M38`–`M45` 🔴 **`699` GAP-2**: either half not read; the note never drawn; `699`'s both-flags
   exception broken; the inert row's hover and the refusal left off; the ruled words, on the face and
   on the hover, changed.
 * `M46`–`M49` 🔴 **`690`'s `retracted`**: the quiet style keyed on a list of two again; the body
   or the state line left loud; the export's reason dropped.
 * `M50`–`M55` 🔴 **`700` §5**: the marks or the default not copied; either gate removed; the lines
   not drawn; the refusals dimmed.
 * `M56` ⚑ **`701`'s own sweep**: the band offering to take over a holder with nothing running.
 * `M57`–`M64` 🔴 **`701`'s first review round**: a start from one pane taking the surface from
   another; End landing on whatever `activeId` names; the way back forgetting the conversation, or
   going back into a reading with nothing to draw; one start flag for every pane; the pane never
   knowing its premise moved; an unanswered read falling through to a start; a refused start written
   onto the rail's row.
 * `M65`–`M68` 🔴 **its second round**: the pane never saying its premise moved; End offered over a
   conversation that did; the list not asked again after a cancelled start; End's way back taking a
   person from an open pressed while it was in the air.

## ⛔ What this table cannot reach

 * ⚠️ **`RuntimeScreen`'s glue is read, not mounted** — nothing in this repository mounts it
   (`211` §11). `M16`–`M20` and `M27` are killed by censuses over its source, and the order its
   doors are handed in is `startBySending`'s, which IS driven (`M2`–`M7`) and driven again over a
   real host and the real store.
 * ⚠️ **The host's no-start Close and the kept-open fact** are main's (`692`'s and `699`'s rows).
 * ⚠️ **The photographs** are evidence, not assertions.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, never a tree a dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
COMPOSABLES = "apps/desktop/src/renderer/src/composables"
KEPT_OPEN = "apps/desktop/src/renderer/src/lib/kept-open.ts"
WORK_REPORT = "apps/desktop/src/renderer/src/lib/work-report.ts"
RUNTIMESCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SESSION_STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
DRAFTS = "apps/desktop/src/renderer/src/lib/drafts.ts"
SIDERAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
CONVERSATIONPANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
WORK_GIVEN_OUT = "apps/desktop/src/renderer/src/lib/work-given-out.ts"

KEPT = f"{LIB}/kept-open.ts"
PANE = f"{COMPONENTS}/KeptOpenPane.vue"
RAIL = f"{COMPONENTS}/SideRail.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
SURFACE = f"{COMPOSABLES}/useSurface.ts"
DRAFTS = f"{LIB}/drafts.ts"
STORE = f"{LIB}/session-store.ts"
PALETTE = f"{LIB}/command-palette.ts"
SESSIONS = f"{COMPONENTS}/ResumableSessions.vue"
THREADS = f"{LIB}/closed-threads.ts"
WORDS = f"{LIB}/work-report.ts"
GIVEN = f"{LIB}/work-given-out.ts"
ENTRY = f"{COMPONENTS}/WorkReportEntry.vue"
HELD = f"{COMPONENTS}/QueuedMessage.vue"
FACTS = f"{COMPONENTS}/WorkFacts.vue"
EXPORT = f"{LIB}/readable-export.ts"
QUEUE = f"{LIB}/persons-queue.ts"
QUEUE_VIEW = f"{COMPONENTS}/PersonsQueue.vue"

FIRST = "a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts"
HANDED = "what-main-handed-and-nobody-drew.render.test.ts"
SEEN = "what-a-quit-left-open-on-screen.dom.test.ts"
RAILDOM = "closed-rail.dom.test.ts"
PALETTE_TEST = "command-palette.test.ts"
SESSIONS_DOM = "closed-threads.dom.test.ts"
FOREST = "who-called-whom-as-generations.test.ts"

MUTATIONS = [
    # ── F-a · the press and the first send ──────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the rail's press on a row the quit left open is the Reopen again** · the provider "
        f"starts at the PRESS (`692` F-a) — killed by `{RAILDOM}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # press on a row the quit left open must start nothing. The rail row is now `emit('select')`
        # and the screen's `select` is the one door for the rail, the room and the Team page, so the
        # plant sends it to `store.resume` (the Reopen) instead of `openConversation`, which only
        # looks. `closed-rail.dom.test.ts` no longer reaches it because it only asserts the emit;
        # the screen census tests kill it.
        [
            (RUNTIMESCREEN, 'function select(sessionId: string): void {\n  void openConversation(sessionId)\n}', 'function select(sessionId: string): void {\n  void store.resume(sessionId)\n}'),
        ],
    ),
    (
        "M2 · ⛔ **two starts of one conversation** · a second send while the first start is in the "
        f"air asks the host again — killed by `{FIRST}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — Two starts of one
        # conversation is still a defect, but the guard moved. `kept-open.ts`'s `inFlight.has` is
        # gone, and `RuntimeScreen.send` now decides it: a recorded conversation continues only when
        # `!starting`, and while a start is in the air a second message goes to the host's queue
        # behind the start. The plant drops `&& !starting`, so a second send calls
        # `continueIt`/`startAndSend` again.
        [
            (RUNTIMESCREEN, "  if (store.get(sessionId)?.phase === 'recorded' && !starting) {\n", "  if (store.get(sessionId)?.phase === 'recorded') {\n"),
        ],
    ),
    (
        "M3 · 🔴 **the words lost on a refused start** · the composer cleared on send and nothing "
        f"put them back — killed by `{FIRST}`",
                # ⚑ **Re-anchored in place by `737`** (`735` §3 — the pane's first send is ONE act, `startAndSend`):
                # the words go back on every arm that did not send; the row still removes that.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — This commit itself
        # touched `kept-open.ts` to add D-017 · R10's `tookItsPlace` hand-over, changing
        # `doors.restore(sessionId, ...)` to `doors.restore(came?.tookItsPlace ?? sessionId, ...)`
        # and splitting the line — surface moved, rule unchanged: 'every arm the words did not go
        # puts them back.' Removing the restore call still loses a refused start's words.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: every
        # arm the words did not go puts them back, so a refused start does not lose them. It now
        # lives in `RuntimeScreen.continueIt`, which calls
        # `restoreRefused(draftKey(came?.tookItsPlace ?? sessionId), …)` when `came === null ||
        # !came.sent`. The plant removes that call, so the composer stays cleared after a refusal.
        [
            (RUNTIMESCREEN, '    restoreRefused(draftKey(came?.tookItsPlace ?? sessionId), text, attachments)\n', ''),
        ],
    ),
    (
        "M4 · 🔴 **the words lost when the send after a good start is refused** — killed by "
        f"`{FIRST}`",
                # ⚑ **Re-anchored in place by `737`** (`735` §3 — the pane's first send is ONE act, `startAndSend`):
                # the start kept and handed over is the one arm left of a refused send after a good start
                # (`735` F-1), and its words go back through the same line — the row now spares that arm.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same relocated line as M3
        # (commit added `tookItsPlace` here); the rule 'a send refused after a good start still
        # restores the words' is unchanged. Narrowing the guard to `!came.sent && !came.openHere`
        # reproduces the exact original defect: words lost when a kept start's send is refused.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — `kept-open.ts` is
        # deleted, but the arm survives in `RuntimeScreen.continueIt`, which still restores the
        # words on `came === null || !came.sent`. The plant narrows the guard to `!came.sent &&
        # !came.openHere`, so a start that was kept and handed over and then had its send refused
        # loses the words. The screen is never mounted, so the row dies on the premise census over
        # its source.
        [
            (RUNTIMESCREEN, '  if (giveTheWordsBack && (came === null || !came.sent)) {\n', '  if (giveTheWordsBack && (came === null || (!came.sent && !came.openHere))) {\n'),
        ],
    ),
    (
        "M5 · ⚑ **a refused start unsaid** · the surfaces are settled with no refusal — killed by "
        f"`{FIRST}`",
                # ⚑ **Re-anchored in place by `737`** (`735` §3 — the pane's first send is ONE act, `startAndSend`):
                # a refusal is the store's sentence (no answer) or the host's (`whatTheFirstMessagePaneSays`).
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that a refused
        # start is said still holds. It moved from `startBySending`'s `doors.startRefusal()` /
        # `whatTheFirstMessagePaneSays` to `store.startAndSend`, which writes the host's sentence
        # onto the conversation's own record beside the composer. The plant settles the refused
        # start with no sentence.
        [
            (SESSION_STORE, '        else starting.error = said\n', '        else starting.error = null\n'),
        ],
    ),
    (
        # ⚑ Landing D-017b (3af91dcb) · killer:
        # `the-person-is-taken-to-the-conversation-that-took-a-recorded-ones-place.test.ts` (the
        # landing added it: `continueIt` is mounted by nothing, so its census names the call).
        "M6 · ⚑ **the person never taken to the conversation it started** — killed by "
        f"`{FIRST}`",
                # ⚑ **Re-anchored in place by `737`** (`735` §3 — the pane's first send is ONE act, `startAndSend`):
                # the person is taken to the conversation when it is open here.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same commit hunk:
        # `show(sessionId)` became `show(came.tookItsPlace ?? sessionId)` for D-017 · R10. The rule
        # ('take the person to the conversation it actually started') is unchanged; removing the
        # call reproduces the original defect verbatim, just against the new expression.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that the person
        # is taken to the conversation the send went to survives, but only for R10's replacement:
        # `continueIt` calls `showConversation(came.tookItsPlace, from)` when the history could
        # never be reopened and another conversation took its place. The person is otherwise already
        # in the full view. No existing test reads that line, so the landing agent must add one
        # census assertion to the premise test before this row can go red.
        [
            (RUNTIMESCREEN, '  if (came?.tookItsPlace !== undefined && came.openHere) showConversation(came.tookItsPlace, from)\n', ''),
        ],
    ),
    (
        "M7 · ⛔ **the draft slot not held through the start** · a refused start's words are swept "
        f"with the slot (`678` R26) — killed by `{FIRST}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in
        # `RuntimeScreen.continueIt`. A recorded conversation's draft slot is held through the whole
        # start by `draftSweep.reopening(sessionId, gesture)` (drafts.ts), which replaced
        # `kept-open.ts`'s `doors.hold`. The plant runs the gesture with no hold, and the killer's
        # premise census pins the `await draftSweep.reopening(sessionId, async () => { answer.came =
        # await store.startAndSend(...) ... })` shape on the screen's `continueIt` body.
        [
            (RUNTIMESCREEN, 'await draftSweep.reopening(sessionId, async () => {', 'await (async (_id: string, gesture: () => Promise<boolean>) => gesture())(sessionId, async () => {'),
        ],
    ),
    (
        "M8 · ⚑ **the pane's composer never `starting`** · no Cancel while its start is in the air — "
        f"killed by `{SEEN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — D-017b deleted KeptOpenPane and moved the rule to ConversationPane.
        # While a first message's start is in the air (`launching`), composerState is 'busy' and the
        # composer offers a Stop that cancels the start. The plant makes a launching pane return
        # 'idle' instead, which is the label's defect, a composer that is never 'starting' and so
        # has no Cancel while its start is in the air. The mounted test in
        # a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts (its launching:true arm)
        # kills it, and the label's killer basename should be replaced with that file.
        [
            (CONVERSATIONPANE, "  if (props.launching === true) return 'busy'\n", "  if (props.launching === true) return 'idle'\n"),
        ],
    ),
    (
        "M9 · 🔴 **the pane's send goes nowhere** · the first message cannot start it — killed by "
        f"`{SEEN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — KeptOpenPane.vue is gone in D-017b. The rule that a recorded
        # conversation's composer send must reach the host now lives on ConversationPane's
        # PromptComposer `@send` at line 1955, which RuntimeScreen wires to `send()` and then
        # `continueIt` and `store.startAndSend`. Replacing that handler with a no-op plants the same
        # defect (the first message cannot start the conversation), and the existing dom test's
        # 'composer is live' case observes `onSend` and goes red for that reason. The `old` text
        # occurs exactly once in ConversationPane.vue and the killer file exists in
        # apps/desktop/test/dom.
        [
            (CONVERSATIONPANE, '          @send="(text, intent, handed) => emit(\'send\', text, intent, handed)"\n', '          @send="() => {}"\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the pane's End button
        # reaching the host. D-017b deleted that button with `KeptOpenPane.vue`; its commit message
        # says 'No End conversation button, no kept-open pane, no reading-only pane, no Reopen /
        # Take it over / Read the recording presses: one press, \'Open the conversation\'', and the
        # card says 'no *End conversation* button'. There is no End press left to plant a dead
        # handler on. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 **the pane's End goes nowhere** (`692` F-b) — killed by " f"`{SEEN}`",
        [(PANE, "        @click=\"emit('end')\"\n", '        @click="() => {}"\n')],
    ),
    (
        "M11 · ⛔ **a card asked before the quit drawn live** · Allow and Deny over a provider that "
        f"stopped at the quit — killed by `{SEEN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # permission card left by a life that stopped is drawn settled, with no Allow or Deny. The
        # kept-open pane's `markReadOnly(state, ASKED_BEFORE_THE_QUIT)` is gone; the full view is
        # folded from the recorded hand-over's `liveFrom`, and crossing that epoch runs
        # `markReopened`, which settles open cards with the note 'settled when this conversation was
        # last open'. The plant deletes that `settlePending` call, so the card comes back live.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # permission card left open by a life that stopped is drawn settled, with no Allow or Deny.
        # D-016 only dropped the third argument of `settlePending` in `markReopened` (`'released'`
        # is now the default, since there are no proposals to hold), so the call still exists once
        # with the old note text.
        [
            (TRANSCRIPT, "  settlePending(state, 'settled when this conversation was last open')\n", ''),
        ],
    ),
    (
        "M12 · ⚑ **a refused start or End unsaid in the pane** — killed by " f"`{SEEN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # refused start is said beside the box. The pane's `kept-open-failure` line is gone;
        # `store.startAndSend` now writes the host's sentence on the conversation's own record
        # (`starting.error = said`), which the composer draws. The plant drops the write on the arm
        # that covers a refusal where nothing it started runs here.
        [
            (SESSION_STORE, '        else starting.error = said\n', '        else void said\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects End being disabled
        # while a start is in the air, and End is gone. D-017b's commit message says 'No End
        # conversation button, no kept-open pane …: one press, \'Open the conversation\'', and the
        # card says 'no *End conversation* button'. What remains over a start in the air is the
        # composer's Stop (`stopIt` → `cancelLaunch`), which is a different control with no row in
        # this table. Its anchor is left stale, so the census records it retired.
        "M13 · ⚑ **End live while a start is in the air** — killed by " f"`{SEEN}`",
        [
            (
                PANE,
                # ⚑ **Re-anchored in place by `737`** (review): End is withheld when the answer says it moved
                # too (`itMoved`); the row still lets End be pressed while a start is in the air.
                '        :disabled="props.ending || props.starting || itMoved"\n',
                '        :disabled="props.ending || itMoved"\n',
            )
        ],
    ),
    # ── F-a/F-b · the routes ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the `kept-open` place
        # drawing the launcher, but D-017b removed that place from `useSurface.ts` along with the
        # pane it drew. Its commit message says 'Every conversation opens in the one full view
        # (header, controls, right panel) whatever its process is doing', so no press goes to a
        # special place. There is no `'kept-open': 'kept-open'` line left to plant. Its anchor is
        # left stale, so the census records it retired.
        "M14 · 🔴 **the place draws the launcher** · a press opens nothing — killed by " f"`{FIRST}`",
        [(SURFACE, "  'kept-open': 'kept-open',\n", "  'kept-open': 'launcher',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the word `kept-open`
        # being reserved so a project cannot take it as a slug. D-017b deleted the place and its
        # reserved word from `useSurface.ts`, since 'Every conversation opens in the one full view …
        # whatever its process is doing'. With no such place, reserving its word protects nothing.
        # Its anchor is left stale, so the census records it retired.
        "M15 · ⛔ **the word not reserved** · a project could be named it and the place read as a "
        f"slug — killed by `{FIRST}`",
        [(SURFACE, "  'reading',\n  'kept-open',\n", "  'reading',\n")],
    ),
    (
        "M16 · 🔴 **the Reopen presses that cannot tell start it again** · the room, the Team page "
        f"and the forest — killed by `{FOREST}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: no
        # press on a conversation that is not fed here may start it. The presses (room, Team page,
        # forest, queue, library, work report) that were split across `pressReopen` and
        # `openKeptOpen` now all go through `openConversation`, which looks with `store.look`. The
        # plant makes that shared door resume instead, so every one of those presses starts the
        # provider again.
        [
            (RUNTIMESCREEN, '  const opened = store.isLive(sessionId) ? sessionId : await store.look(sessionId)\n', '  const opened = store.isLive(sessionId) ? sessionId : await store.resume(sessionId)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the forest's
        # closed-node press taking the `reopen:` arm straight to the start instead of the library's
        # answer. D-017b deleted `closed-press.ts` and the `closedPress` handlers, and its commit
        # message says 'One Conversations list … no open / closed / kept-open split' and 'one press,
        # \'Open the conversation\''. A forest node now emits `openConversation` for every node, and
        # no start is reachable from that press. Its anchor is left stale, so the census records it
        # retired.
        "M17 · 🔴 **the forest's closed press straight to the start** — killed by " f"`{FOREST}`",
        [
            (
                SCREEN,
                "  reopen: (sessionId) => pressReopen(sessionId),\n",
                "  reopen: (sessionId) => reopen(sessionId),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects a take-over refused
        # *not-running* falling through to the kept-open door instead of dead-ending. D-017b removed
        # the take-over fork itself: its commit message says 'no Reopen / Take it over / Read the
        # recording presses: one press, \'Open the conversation\'', and the screen has no `takeOver`
        # function or refusal to route. The stalled band's and a report's presses now call
        # `openConversation`, so there is no refusal left to dead-end on. Its anchor is left stale,
        # so the census records it retired.
        "M18 · ⚑ **a take-over refused *not-running* says the refusal** · the stalled band's and a "
        f"report's press dead-ends on a Reopen — killed by `{FIRST}`",
        [(SCREEN, "      if (await openKeptOpen(sessionId, from)) return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the host's own
        # question (`keptOpenAcrossAQuit` and `running === 'not-running'`) telling a kept-open row
        # from a closed recording. D-017b removed that distinction: its commit message says 'One
        # Conversations list in the rail and the palette, each row with the shared state: no open /
        # closed / kept-open split'. Every row opens the same full view, so the screen asks nothing.
        # Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 **the host's own question not asked** · any resumable row opens the pane, so a "
        f"closed recording is never reopened — killed by `{FIRST}`",
        [
            (
                SCREEN,
                "      row.sessionId === sessionId && row.keptOpenAcrossAQuit && row.running === 'not-running',\n",
                "      row.sessionId === sessionId && row.running === 'not-running',\n",
            )
        ],
    ),
    (
        "M20 · ⚑ **the screen hands the sweep no conversation the quit left open** — killed by "
        f"`{FIRST}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # draft sweep must be told which conversations are listed, or their words go the moment a
        # person walks away. The screen's fourth door is now `rail.value?.listedIds ?? []` (every id
        # the one list names) instead of `keptOpenIds`. The plant hands the sweep an empty list.
        [
            (RUNTIMESCREEN, '  () => rail.value?.listedIds ?? [],\n', '  () => [],\n'),
        ],
    ),
    (
        "M21 · 🔴 **the sweep ignores its fourth door** · a kept-open conversation's words go the "
        f"moment its pane is left — killed by `{FIRST}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # `sweepDrafts` keeps the words of every listed conversation. The door is now `listed`
        # (destructured as `inTheList`) instead of `keptOpen`, so the plant removes
        # `...inTheList.map(draftKey)` from the kept slots.
        [
            (DRAFTS, '        ...inTheList.map(draftKey),\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the pane's End
        # reaching the host's no-start Close (`692` F-b). D-017b removed the End button and the
        # kept-open pane: its commit message says 'No End conversation button, no kept-open pane, no
        # reading-only pane …', and the card says 'no *End conversation* button'. The anchor `await
        # bridge.close({ sessionId })` is gone, and the remaining `store.close` caller is the
        # grant/sign-in close-and-reopen, a different subject not on this row. Its anchor is left
        # stale, so the census records it retired.
        "M22 · 🔴 **End never reaches the host** (`692` F-b) — killed by " f"`{FIRST}`",
        [(STORE, "      await bridge.close({ sessionId })\n", "      void sessionId\n")],
    ),
    (
        "M23 · ⚑ **the row whose pane is on screen not drawn active** — killed by " f"`{SEEN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # row whose conversation is on screen is drawn active. `keptOpenOnScreen` is gone and the
        # row's class is now `{ active: row.sessionId === onScreenId }`, so the plant pins it to
        # `false`. The CSS still keys the surface and the accent bar on `.rail-item.active`.
        [
            (SIDERAIL, '              :class="{ active: row.sessionId === onScreenId }"\n', '              :class="{ active: false }"\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the palette saying
        # *Reopen* only for a conversation that is not open. D-017b removed the verb and the split:
        # its commit message says 'One Conversations list in the rail and the palette, each row with
        # the shared state: no open / closed / kept-open split'. A palette row is now titled by its
        # label and its action is always `{ kind: 'select' }`, so no Reopen wording exists. Its
        # anchor is left stale, so the census records it retired.
        "M24 · ⚑ **the palette offers to *Reopen* a conversation that is open** — killed by "
        f"`{PALETTE_TEST}`",
        [
            (
                PALETTE,
                "            `${row.keptOpen ? 'Open' : 'Reopen'} ${row.label}`",
                "            `Reopen ${row.label}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the Sessions page
        # listing a conversation the quit left open under *Reopen a closed conversation* with a
        # Resume that starts it. D-017b removed the `keptOpenAcrossAQuit` gate and the Resume press,
        # since its commit message says 'no Reopen / Take it over / Read the recording presses: one
        # press, \'Open the conversation\''. `ResumableSessions.vue` offers one `sessions-open-`
        # button on every row, and `closed-threads.dom.test.ts` asserts no `resume-` button exists.
        # Its anchor is left stale, so the census records it retired.
        "M25 · 🔴 **the Sessions page lists it under *Reopen a closed conversation*** · `ended`, with "
        f"a Resume that starts it — killed by `{SESSIONS_DOM}`",
        [(SESSIONS, "      !session.keptOpenAcrossAQuit,\n", "      true,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects the rail's hover
        # sentence about what a press does, which lived in `closed-threads.ts`. D-017b deleted that
        # file, and the rail row now hovers only its place. The commit message says 'No sentence
        # says whether a process runs', and the card says 'no sentence about whether anything is
        # running, since that's a process fact (`05` rule 5)'. Its anchor is left stale, so the
        # census records it retired.
        "M26 · ⚑ **the rail's hover says the press starts it** — `692`'s sentence, false since "
        f"`701` — killed by `{RAILDOM}`",
        [
            (
                THREADS,
                "  'sent to it — pressing it here opens it, and the first message you send starts it. If BroBot ' +\n",
                "  'sent to it — pressing it here starts it. If BroBot ' +\n",
            )
        ],
    ),
    (
        "M27 · 🔴 **the Team page's press straight to the start** · its shelves list every "
        f"conversation of an identity and cannot tell one the quit left open — killed by `{FIRST}`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 725 — the Team page's tag also binds `@open-kept-open` (a row
        # it SAID was open is opened, never reopened); the `@reopen` this row flips is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # Team page's press on a conversation must not go straight to a start. Its
        # `@reopen`/`@open-kept-open` split collapsed into one `@open-conversation="select"` on
        # `<TeamWorkspace>`, which the roster rows and the forest both use. The plant binds it
        # straight to `store.resume`.
        [
            (RUNTIMESCREEN, '          @open-conversation="select"\n', '          @open-conversation="(sessionId) => void store.resume(sessionId)"\n'),
        ],
    ),
    # ── 699 GAP-1 ───────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Commit 8d54d6dc removed "the window's left-open and idle words" on purpose.
        # `leftOpenByTheQuit` (the `holderKeptOpen === true && stalledBecause ===
        # 'conversation_ended'` predicate) is deleted from work-report.ts, `holderKeptOpen` is
        # dropped from `WorkWords`, and `conversation_ended` is no longer a stall cause. There is no
        # anchor and no defect left to plant. Its anchor is left stale, so the census records it
        # retired.
        "M28 · ⛔ **the cause conjunct dropped** · work stalled because its turn ended reads as the "
        f"quit's — killed by `{HANDED}`",
        [
            (
                WORDS,
                "  return report.holderKeptOpen === true && report.stalledBecause === 'conversation_ended'\n",
                "  return report.holderKeptOpen === true\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Same removal as M28. The `=== true` reading of `holderKeptOpen` in `leftOpenByTheQuit` is
        # gone with the predicate, and the wire field is no longer read by the renderer. Only the
        # store's inert-history comment mentions it. Its anchor is left stale, so the census records
        # it retired.
        "M29 · ⛔ **a truthy flag honoured** · a bundle's `\"yes\"` reads as kept open — killed by "
        f"`{HANDED}`",
        [
            (
                WORDS,
                "  return report.holderKeptOpen === true && report.stalledBecause === 'conversation_ended'\n",
                "  return Boolean(report.holderKeptOpen) && report.stalledBecause === 'conversation_ended'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row plants the left-open words never being said. `LEFT_OPEN_WORDS` and the `{
        # ...reading, ...LEFT_OPEN_WORDS[readAt] }` line are deleted, and `workReading` now returns
        # the plain `undrivenReason ?? stateWord` reading. The commit lists "the window's left-open
        # and idle words" among what is gone with (c). Its anchor is left stale, so the census
        # records it retired.
        "M30 · 🔴 **the words never said** · *has ended* about a conversation the rail calls open — "
        f"killed by `{HANDED}`",
        [
            (
                WORDS,
                "  return leftOpenByTheQuit(report) ? { ...reading, ...LEFT_OPEN_WORDS[readAt] } : reading\n",
                "  return reading\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `now` versus `as-reported` reading moment existed only to choose between two left-open
        # wordings. `WorkReadAt` and `LEFT_OPEN_WORDS` are deleted and `workReading(report)` takes
        # one argument. The card says a stop, a reopen and a start tell nobody anything, so no
        # snapshot-versus-live distinction remains. Its anchor is left stale, so the census records
        # it retired.
        "M31 · 🔴 **the reading moment ignored** · a snapshot read as live (`699` F-5) — killed by "
        f"`{HANDED}`",
        [
            (
                WORDS,
                "  return leftOpenByTheQuit(report) ? { ...reading, ...LEFT_OPEN_WORDS[readAt] } : reading\n",
                "  return leftOpenByTheQuit(report) ? { ...reading, ...LEFT_OPEN_WORDS.now } : reading\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `'now'` argument to `workReading` no longer exists; work-given-out.ts now spreads
        # `...workReading(row)`. The plant would append an ignored second argument and stay green.
        # The reading-moment rule it protected was removed with the left-open words. Its anchor is
        # left stale, so the census records it retired.
        "M32 · ⚑ **the Work tab reads its live fact as a snapshot** — killed by " f"`{HANDED}`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 718 — `707` GAP-3: the row is handed its project when it is
        # not the reader's (`elsewhere`) before it is worded. The defect planted is unchanged.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The Work tab still reads
        # its live fact through `workReading(..., 'now')` in `rowOf`. D-016 deleted the `elsewhere`
        # / `projectElsewhere` wrapper (Task #N in <project>), so the call is now `workReading(row,
        # 'now')`; the defect (`'as-reported'` instead of `'now'`) is unchanged.
        [
            (WORK_GIVEN_OUT, "    ...workReading(row, 'now'),\n", "    ...workReading(row, 'as-reported'),\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # WorkReportEntry.vue now reads `workReading(props.item.report)` with no `'as-reported'`
        # argument, so the old anchor is gone. Replacing it with `'now'` would be an ignored extra
        # argument and cannot go red. The snapshot-versus-live rule died with "the window's
        # left-open and idle words". Its anchor is left stale, so the census records it retired.
        "M33 · ⚑ **the transcript's report reads its snapshot as live** — killed by " f"`{HANDED}`",
        [
            (
                ENTRY,
                "const reading = computed(() => workReading(props.item.report, 'as-reported'))\n",
                "const reading = computed(() => workReading(props.item.report, 'now'))\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # QueuedMessage.vue now calls `workReading(props.item.report)` with no reading-moment
        # argument, and the comment about a held notice's report being a snapshot is deleted. The
        # defect (a snapshot read as live) cannot be expressed in today's code. Its anchor is left
        # stale, so the census records it retired.
        "M34 · ⚑ **a held notice's report reads its snapshot as live** — killed by " f"`{HANDED}`",
        [
            (
                HELD,
                "  props.item.report === undefined ? null : workReading(props.item.report, 'as-reported'),\n",
                "  props.item.report === undefined ? null : workReading(props.item.report, 'now'),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `WorkReading.title` is deleted from work-report.ts, and WorkFacts.vue now renders `<span
        # v-else class="wr-word" data-cy="work-report-word">` with no `:title`. The hover carried
        # the band's left-open sentence (`KEPT_OPEN_UNDRIVEN`), one of the words the commit removed
        # on purpose. Its anchor is left stale, so the census records it retired.
        "M35 · ⚑ **the band's sentence gone from the Work tab's hover** — killed by " f"`{SEEN}`",
        [(FACTS, ' :title="reading.title ?? undefined"', "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `IDLE` and `IT_WAS_IDLE` are deleted from work-report.ts, and `KEPT_OPEN_UNDRIVEN` is
        # deleted from tasks.ts and stalled-work.ts ("the two R54 leads on the stalled-work band").
        # The band no longer has a kept-open sentence for the renderer's word to drift from, and
        # `stalledWorkSaid` is just `undrivenSentence(work.because)`. Its anchor is left stale, so
        # the census records it retired.
        "M36 · ⚑ **the snapshot's words drift from the band's sentence** — killed by " f"`{HANDED}`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 725 — the constant moved, unchanged, to `kept-open.ts`
        # (the stalled band's lead says it too, and the person's queue may not reach `work-report`).
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The renderer still keeps
        # its own copy of the band's opening clause, pinned against drift from the shared
        # `KEPT_OPEN_UNDRIVEN` sentence. D-017 R2 renamed and reworded the constant from the
        # quit-only `THE_QUIT_LEFT_IT_OPEN = 'the app quit while it was open'` to the general
        # `IT_HAS_STOPPED = 'it has stopped'` (kept-open.ts's own docblock: "a test pins it as that
        # sentence's opening words so the two cannot drift"), but the drift-guard rule is identical.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # renderer's copy of the band's lead must not drift from the shared sentence, and the
        # snapshot's word is that lead in the past tense. `IT_HAS_STOPPED` in the deleted
        # `kept-open.ts` is now `IDLE = 'idle'` in `work-report.ts`, pinned against
        # `KEPT_OPEN_UNDRIVEN` ('it is idle with this work open …'). The plant changes the word so
        # it no longer opens the sentence.
        [
            (WORK_REPORT, "export const IDLE = 'idle'\n", "export const IDLE = 'idle here'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `word: IDLE` line is deleted with `LEFT_OPEN_WORDS`. The pill's word is now
        # `undrivenReason(report.stalledBecause) ?? stateWord(report.state)` for every report, so
        # there is no second, live-only word left to drift from the rail's. Its anchor is left
        # stale, so the census records it retired.
        "M37 · ⚑ **the live word is not the rail's** · two accounts of one child — killed by "
        f"`{HANDED}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The Work tab's LIVE pill
        # still names a dedicated constant rather than a magic literal, guarding "two accounts of
        # one child" drift. D-017 R2 deliberately gave the Work tab its OWN word
        # (`STOPPED_NOTHING_RUNNING`, no longer borrowed from the rail's `KEPT_OPEN_NOTE` — the test
        # now explicitly asserts `expect(STOPPED_NOTHING_RUNNING).not.toBe(KEPT_OPEN_NOTE)`), but
        # the rule that the rendered word must equal the named constant (not drift to an arbitrary
        # literal) survives.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — This commit renamed the
        # shared constant `STOPPED_NOTHING_RUNNING` → `IT_HAS_STOPPED` (`'stopped · nothing
        # running'` → `'it has stopped'`, per D-017 rule 5 dropping the process fact) but the pill
        # still reads it from the same shared module as the rail's own word, at the same call site
        # in `work-report.ts`. The rule 'the live word must be the rail's, not a second account' is
        # unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The Work tab's live word
        # for a stopped holder is still one named constant in `work-report.ts`, and D-017b changed
        # the constant to `IDLE` ('idle'), the one state's word, so the rule 'the live word is the
        # shared state word, not a second account' survives. The plant swaps the constant for a
        # literal 'still open'.
        [
            (WORK_REPORT, '    word: IDLE,\n', "    word: 'still open',\n"),
        ],
    ),
    # ── 699 GAP-2 ───────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted `closed-threads.ts` and
        # removed `closedBecauseTheAppDidNotFinishQuitting` from the wire, and the test's own
        # docblock says '§2 · 699 GAP-2 gone with its subject'. There is no closed row now, so
        # nothing reads the crash flag. Card: 'No open / closed / kept-open split... one list of
        # conversations' and 'no sentence about whether anything is running'. Its anchor is left
        # stale, so the census records it retired.
        "M38 · 🔴 **the resumable half not read** · a crash says nothing on the rows it reopens from "
        f"— killed by `{HANDED}`",
        [
            (
                THREADS,
                "      // ⚑ **701 · `=== true`**: a hand-built fixture or an older host can leave it out.\n"
                "      closedByAnUnfinishedQuit: session.closedBecauseTheAppDidNotFinishQuitting === true,\n",
                "      // ⚑ **701 · `=== true`**: a hand-built fixture or an older host can leave it out.\n"
                "      closedByAnUnfinishedQuit: false,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The unresumable half of
        # `closedThreads` and the `closedBecauseTheAppDidNotFinishQuitting` flag are gone. The new
        # `conversation-list.ts` folds both host lists into one row shape that carries only the
        # shared state and `inAnotherWindow`, so no 'closed because BroBot did not finish quitting'
        # note exists to omit. Its anchor is left stale, so the census records it retired.
        "M39 · 🔴 **the unresumable half not read** (`699`: *on both halves*) — killed by "
        f"`{HANDED}`",
        [
            (
                THREADS,
                "      // first turn named it has no ref, so it is here.\n"
                "      closedByAnUnfinishedQuit: session.closedBecauseTheAppDidNotFinishQuitting === true,\n",
                "      // first turn named it has no ref, so it is here.\n"
                "      closedByAnUnfinishedQuit: false,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The note this row kept drawn ('closed
        # because BroBot did not finish quitting') lived in `closedThreads`, which D-017b deleted.
        # The card removes the closed list and every sentence about process state on purpose. Its
        # anchor is left stale, so the census records it retired.
        "M40 · 🔴 **the note never drawn** — killed by " f"`{HANDED}`",
        [
            (
                THREADS,
                "  if (row.closedByAnUnfinishedQuit) {\n    const said = [\n",
                "  if (false) {\n    const said = [\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row carried both flags,
        # `keptOpenAcrossAQuit` and `closedBecauseTheAppDidNotFinishQuitting`, and drew 'closed
        # because...' under a Conversations heading. There is no keptOpen flag, no crash flag and no
        # split list now, so 699's exception has nothing to protect. Commit: 'no open / closed /
        # kept-open split'. Its anchor is left stale, so the census records it retired.
        "M41 · ⛔ **`699`'s exception broken** · a row carrying both flags reads *closed because…* "
        f"under Conversations — killed by `{HANDED}`",
        [
            (
                THREADS,
                "  if (row.keptOpen && row.gesture === 'reopen') {\n",
                "  if (row.keptOpen && row.gesture === 'reopen' && !row.closedByAnUnfinishedQuit) {\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** An inert closed row's hover ('closed
        # because...') was part of `closedThreads`, which is deleted. Rows now say only the shared
        # state, and 'Never whether a process runs (05 rule 5)'. Its anchor is left stale, so the
        # census records it retired.
        "M42 · ⚑ **the inert row's hover never says why it is closed** — killed by " f"`{HANDED}`",
        [
            (
                THREADS,
                "        (row.closedByAnUnfinishedQuit ? `. ${CLOSED_BY_AN_UNFINISHED_QUIT_TITLE}` : ''),\n",
                "        '',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The crash row's hover, which carried
        # the store's refusal for an unreadable conversation, is gone with `closedThreads`.
        # `conversation-list.ts` draws no refusal or reason on a row, and every conversation opens
        # in its full view. Its anchor is left stale, so the census records it retired.
        "M43 · ⚑ **the store's refusal left off the crash row's hover** · the reason it only reads "
        f"is lost from the unresumable half — killed by `{HANDED}`",
        [(THREADS, "      row.refusal === null\n        ? null\n", "      true\n        ? null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `CLOSED_BY_AN_UNFINISHED_QUIT` (the
        # words ruled in 692 F-l) no longer exists. The commit removed the closed row and the crash
        # flag that carried them, and the test's §2 block is replaced by a 'gone with its subject'
        # comment. Its anchor is left stale, so the census records it retired.
        "M44 · ⚑ **the ruled words changed** (`692` F-l) — killed by " f"`{HANDED}`",
        [
            (
                THREADS,
                "export const CLOSED_BY_AN_UNFINISHED_QUIT = 'closed because BroBot did not finish quitting'\n",
                "export const CLOSED_BY_AN_UNFINISHED_QUIT = 'closed after BroBot stopped'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The hover sentence 'It is closed
        # because BroBot did not finish quitting: ...' lived in the deleted `closed-threads.ts`. Its
        # ruled face words and the closed row that drew them were removed by D-017b. Its anchor is
        # left stale, so the census records it retired.
        "M45 · 🔴 **the hover paraphrases the ruled words** · at the rail's widths the face cuts them "
        f"and nothing gives them back — killed by `{SEEN}`",
        [
            (
                THREADS,
                "  'It is closed because BroBot did not finish quitting: BroBot was running it when it stopped — a ' +\n",
                "  'BroBot was running it when it stopped without finishing a quit — a ' +\n",
            )
        ],
    ),
    # ── 690's retracted ─────────────────────────────────────────────────────────────────────────
    (
        "M46 · 🔴 **the quiet style keyed on a list of two again** · `retracted` in the waiting row's "
        f"colours (`690`'s GAP) — killed by `{SEEN}`",
        [
            (
                HELD,
                "{ carded, ended: !waiting() }",
                "{ carded, ended: item.outcome === 'cancelled' || item.outcome === 'abandoned' }",
            )
        ],
    ),
    (
        "M47 · ⚑ **an ending's words left loud** — killed by " f"`{SEEN}`",
        [(HELD, ".msg.ended .msg-body {\n", ".msg.never-ended .msg-body {\n")],
    ),
    (
        "M48 · ⚑ **an ending's state line left in the accent** — killed by " f"`{SEEN}`",
        [(HELD, ".msg.ended .state {\n", ".msg.never-ended .state {\n")],
    ),
    (
        "M49 · 🔴 **the export's reason dropped** · *this message was retracted* and nothing more — "
        f"killed by `{HANDED}`",
        [(EXPORT, "          item.detail === undefined ? '' : ` — ${item.detail}`\n", "          ''\n")],
    ),
    # ── 700 §5 · the person's queue ─────────────────────────────────────────────────────────────
    (
        "M50 · 🔴 **the marks not copied** · live Allow and Deny on a marked ask with no word of it — "
        f"killed by `{HANDED}`",
        [
            (
                QUEUE,
                "      marksSay: settling.answers.length === 0 ? [] : (live?.marksSay ?? []),\n",
                "      marksSay: [],\n",
            )
        ],
    ),
    (
        "M51 · 🔴 **refusal's default not copied** — killed by " f"`{HANDED}`",
        [
            (
                QUEUE,
                "      refusesFirst: settling.answers.length > 0 && live?.refusesFirst === true,\n",
                "      refusesFirst: false,\n",
            )
        ],
    ),
    (
        "M52 · ⛔ **the marks drawn beside no buttons** · *Deny comes first here* over an answer "
        f"already sent — killed by `{HANDED}`",
        [
            (
                QUEUE,
                "      marksSay: settling.answers.length === 0 ? [] : (live?.marksSay ?? []),\n",
                "      marksSay: live?.marksSay ?? [],\n",
            )
        ],
    ),
    (
        "M53 · ⛔ **refusal's default claimed beside no buttons** — killed by " f"`{HANDED}`",
        [
            (
                QUEUE,
                "      refusesFirst: settling.answers.length > 0 && live?.refusesFirst === true,\n",
                "      refusesFirst: live?.refusesFirst === true,\n",
            )
        ],
    ),
    (
        "M54 · 🔴 **the lines not drawn** — killed by " f"`{SEEN}`",
        [(QUEUE_VIEW, '            v-for="line in row.marksSay"\n', '            v-for="line in []"\n')],
    ),
    (
        "M55 · 🔴 **the refusals dimmed on a row whose default is refusal** — killed by " f"`{SEEN}`",
        [
            (
                QUEUE_VIEW,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee796dfa split the answers into the request's own buttons and broader choices under More options, each with the same class line, so the anchor takes the primary button's v-if; the plant still dims Deny on a row whose default is refusal.
                "                v-if=\"isAPrimaryAnswer(decision)\"\n                class=\"pq-answer\"\n                :class=\"{ deny: isRefusal(decision) && !row.refusesFirst }\"\n",
                "                v-if=\"isAPrimaryAnswer(decision)\"\n                class=\"pq-answer\"\n                :class=\"{ deny: isRefusal(decision) }\"\n",
            )
        ],
    ),
    # ── 701 · its first review round ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `keptOpenGeneration` guarded one
        # kept-open pane's start against another's, and the kept-open pane and its 'kept-open' place
        # are deleted. The general 'move only if the person has not moved' rule is now
        # `useSurface.showConversation(id, from)`, owned by surface-routing rows. Its anchor is left
        # stale, so the census records it retired.
        "M57 · 🔴 **a start from one pane takes the surface from another** · a View cannot tell two "
        f"kept-open panes apart, nor one still being read — killed by `{FIRST}`",
        [(SCREEN, "      if (keptOpenGeneration !== asked) return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** This row protected where the kept-open
        # pane's End landed. Commit: 'No End conversation button, no kept-open pane', and
        # `leaveKeptOpen` no longer exists. Its anchor is left stale, so the census records it
        # retired.
        "M58 · 🔴 **End lands on whatever `activeId` names** · *back where they were* in the "
        f"docblock and `place = null` in the code — killed by `{FIRST}`",
        [
            (
                SCREEN,
                "    keptOpen.value?.info.sessionId === sessionId\n  )\n    leaveKeptOpen()\n",
                "    keptOpen.value?.info.sessionId === sessionId\n  )\n    place.value = null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `theWayBack` was the way out of the
        # kept-open pane and End, and D-017b deleted the function, the `KEPT_OPEN` place and the
        # pane. The anchor line is gone from `useSurface.ts`. Its anchor is left stale, so the
        # census records it retired.
        "M59 · ⚑ **the way back forgets the conversation a person came from** · the launcher instead — "
        f"killed by `{FIRST}`",
        [(SURFACE, "  if (to !== null && holds(to)) return { place: null, activeId: to }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'reading with no recording'
        # fallback lived in `theWayBack`, deleted with the kept-open way back. The `place:
        # cameFrom.place` line is gone from `useSurface.ts`. Commit: 'no kept-open pane, no End
        # conversation'. Its anchor is left stale, so the census records it retired.
        "M60 · ⚑ **back into a reading whose recording is gone** · a surface with nothing to draw — "
        f"killed by `{FIRST}`",
        [
            (
                SURFACE,
                "      place: cameFrom.place === 'reading' && !reading ? 'sessions' : cameFrom.place,\n",
                "      place: cameFrom.place,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `keptOpenStarting` was the kept-open
        # panes' shared start flag and went with them. Per-conversation start state is now
        # `store.isLaunching(sessionId)`, keyed per gesture and covered by the session-store rows.
        # Its anchor is left stale, so the census records it retired.
        "M61 · 🔴 **one start flag for every pane** · a second pane told the first one's start is its "
        f"own, its composer and End locked — killed by `{FIRST}`",
        [
            (
                SCREEN,
                '          :starting="keptOpenStarting.has(keptOpen.info.sessionId)"\n',
                '          :starting="keptOpenStarting.size > 0"\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The kept-open pane's 'nothing is
        # running' premise and its `keptOpenIds` check are gone. Commit: 'No sentence says whether a
        # process runs', with no kept-open or reading-only pane. Its anchor is left stale, so the
        # census records it retired.
        "M62 · 🔴 **the pane never knows its premise moved** · started by its parent, or ended, while "
        f"on screen, and still saying *nothing is running* — killed by `{FIRST}`",
        [(SCREEN, "  return !(rail.value?.keptOpenIds ?? []).includes(id)\n", "  return false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The defect was an unanswered read
        # falling through to the Reopen at a press (a start). A press now asks `store.look`, which
        # starts nothing, and a failed look is said in `lookError` and returns false, so there is no
        # start to fall through to. Card: 'Open now starts nothing'. Its anchor is left stale, so
        # the census records it retired.
        "M63 · ⛔ **a read that did not answer falls through to a start** · the Reopen at the press, "
        f"on the surfaces that cannot tell (`086`) — killed by `{FIRST}`",
        [
            (
                SCREEN,
                "  } catch (cause) {\n    say(readableError(cause))\n    return true\n  }\n  const info = rows.find(\n",
                "  } catch {\n    return false\n  }\n  const info = rows.find(\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The rail no longer has `markSettled`,
        # the 'open · nothing running' row state or the kept-open failure line. A refused continue
        # is now said on the conversation's own record beside the composer, which M5's re-anchor
        # covers. Its anchor is left stale, so the census records it retired.
        "M64 · ⚑ **a refused start written onto the rail's row** · red over *open · nothing running*, "
        f"and nothing on the kept-open path ever clears it — killed by `{FIRST}`",
        [
            (
                SCREEN,
                "    if (keptOpen.value?.info.sessionId === sessionId) keptOpenFailure.value = refusal\n",
                "    rail.value?.markSettled(sessionId, refusal)\n    if (keptOpen.value?.info.sessionId === sessionId) keptOpenFailure.value = refusal\n",
            )
        ],
    ),
    # ── 701 · its second review round ───────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `KeptOpenPane.vue` is deleted (-409
        # lines). The pane's 'premise moved' line went with the reduced kept-open pane, and no
        # sentence says whether a process runs. Its anchor is left stale, so the census records it
        # retired.
        "M65 · 🔴 **the pane never SAYS its premise moved** — killed by " f"`{SEEN}`",
        # ⚑ **Re-anchored in place by `737`** (review): the pane's own two lines now sit inside a
        # template that stands them down when the failure line says the move — one level deeper.
        [(PANE, '        v-if="props.moved === true"\n        class="kept-open-says moved"\n', '        v-if="false"\n        class="kept-open-says moved"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted KeptOpenPane.vue and
        # the End button that carried the `:disabled="props.ending || props.starting || itMoved"`
        # gate. The commit message says: "No End conversation button, no kept-open pane, no
        # reading-only pane, no Reopen / Take it over / Read the recording presses". The defect (End
        # offered on a moved conversation) has no surface left to plant on. Its anchor is left
        # stale, so the census records it retired.
        "M66 · ⚑ **End offered on a conversation that moved** · *nothing is stopped* over a running "
        f"one — killed by `{SEEN}`",
        [
            (
                PANE,
                # ⚑ **Re-anchored in place by `737`** (review): `itMoved` is the list's move OR the answer's.
                '        :disabled="props.ending || props.starting || itMoved"\n',
                '        :disabled="props.ending || props.starting"\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row's `void
        # rail.value?.refreshResumable()` sat in `startBySending`'s settle path for the kept-open
        # pane, and that path is gone; `continueIt` now goes through `store.startAndSend` inside
        # `draftSweep.reopening`. The list is refreshed only by the `conversations` world-move
        # handler (`rail.value?.refreshResumable().then(lookAgainIfItMoved)`), which the killer
        # file's re-aimed census no longer pins to a start. The killer file says "§2
        # (`startBySending`'s order) is GONE". Its anchor is left stale, so the census records it
        # retired.
        "M67 · ⚑ **the list not asked again after a cancelled start** · the host held a slot while it "
        f"was in the air, so the rail and the pane go on reading *not kept open* — killed by `{FIRST}`",
        [
            (
                SCREEN,
                "    // refused start leaves it kept open, and the list has to say so again.\n    void rail.value?.refreshResumable()\n",
                "    // refused start leaves it kept open, and the list has to say so again.\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `keptOpenGeneration`, `endKeptOpen`
        # and End's way back are removed with the pane. The commit message says "No End conversation
        # button, no kept-open pane", and the killer file notes "§6 (the way back … and End) went
        # with the pane". There is no open-pressed-in-the-air-versus-End race left to guard. Its
        # anchor is left stale, so the census records it retired.
        "M68 · ⚑ **End's way back takes a person from an open pressed while it was in the air** — "
        f"killed by `{FIRST}`",
        [(SCREEN, "    keptOpenGeneration === asked &&\n", "")],
    ),
    # ── 701 · found by its own sweep ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `openingAction(held)`, the fork whose
        # 'Take it over and open it' arm this row planted on a holder with nothing running, was
        # deleted. `stalledWorkView` now sets `action: OPEN_THE_CONVERSATION` unconditionally.
        # Commit: 'no Reopen / Take it over / Read the recording presses: one press, Open the
        # conversation'; §5 of the killer file pins the constant directly. Its anchor is left stale,
        # so the census records it retired.
        "M56 · ⚑ **the band offers to take over a holder with nothing running** · *Take it over and "
        f"open it* on a conversation the quit left open, whose press now opens it — killed by `{FIRST}`",
        [
            (
                QUEUE,
                "      action: openingAction(held.has(work.assignedTo) || work.holderKeptOpen),\n",
                "      action: openingAction(held.has(work.assignedTo)),\n",
            )
        ],
    ),
]
