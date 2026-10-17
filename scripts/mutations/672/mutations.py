"""672 · Three loose ends a person can see — one task, one name; two sentences made true; the Team
page's re-read, priced and then bounded.

⚑ **The PM's §1:** *"a task is Task #N on the cards now, and still a bare #N in three places"* — the
`question_asked` notice, `QueuedMessage`'s held work and the person's queue; the wider search found
a fourth, the project room's roster. **§2:** `656` F5 and F6, measured by `672` — the grant sheet's
reopen told every listed conversation it keeps what was typed (the draft is deleted for any that is
not the selected one), and the stale sign-in notice said *"Nothing here is lost — press Resume on it
under the closed threads"* (the turn fails, approvals and background work do not come back, and the
rail has had no Resume since `151`). **§3:** `668`'s own re-read, measured at 132–146 ms of main per
six-announcement burst on a 200-conversation workspace.

## 🔴 What has to be killable

 * `M1`–`M8` ⚑ **one task, one name**: each of the four rows back to its bare `#N` (the notice, the
   held words, the queue, the roster template); the roster's two arms (a bare number; another
   project's task drawn as this one's); the project said before the number; the code face back on
   the roster's task.
 * `M9`–`M15` 🔴 **F5**: the arm lost at each hop — the fold marks every row selected; the screen
   hands no selected id; the sheet asks for the selected sentence on every row; the chooser ignores
   the arm; the other arm's sentence gets the false clause back; the kept-draft row claims both arms;
   the sign-in bar handed the other arm's sentence.
 * `M16`–`M21` 🔴 **F6**: the retired control named again; the rail's heading spelled apart from the
   constant; the reopen's two losses dropped; an error notice cut to one line again; the title that
   recovers a cut notice gone; a warning left cut.
 * `M30`, `M31` ⚑ **the sweep**: the ended composer names *the rail* again, in its refusal and in its
   hint — the one word no control carries, directly under a notice that names the heading.
 * `M32`–`M35` ⚑ **what `672`'s review found unguarded**: the queue's task without its project; the
   free sentences swapped between arms; the notice's two measured-TRUE clauses dropped; an
   announcement arm calling the bare read.
 * `M36`–`M41` 🔴 **what `672`'s review found wrong**: the stalled row's *Work #3* back; the
   provider's words not marked, and not clamped; a read that throws at once handing its caller no
   promise; the reopen that cannot happen promised; a missing-event sentence past one line.
 * `M22`–`M29` 🔴 **§3**: an ask during a read owes nothing; no coalescing at all; the loop stopping
   after two; a failed read swallowing the owed one; the last read's failure unreported; the screen's
   read unwrapped; one trigger calling the bare read.

## ⛔ What this table cannot reach

 * ⚠️ **The draft deletion itself** — `RuntimeScreen`'s draft watcher is unchanged by `672`, and the
   sentence is what moved. ⚑ Measured, not guarded: the throwaway that proved it drove the real store
   and draft book (`672` response §2).
 * ⚠️ **`main`'s two spellings** (`digest.ts`, `stalled-work.ts`) — handed back, not changed here.
   ⚑ `697` closed both: the digest spells `Task #N` (table `697`), and `stalled-work.ts`' sentence is
   deleted — its giver clause is guarded where it lives now (`557` M8, corrected in place).

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
individually — one row, its killer file, restore-from-bytes — in an isolated worktree, never the
tree the person's dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"

FOLD = f"{LIB}/transcript.ts"
# ⚠️ **697 · CORRECTED IN PLACE** — the spelling moved to `shared/` (`672` H1: main's digest asks it
# too). The file moved; M7's subject — the order of the two words — is unchanged.
CALLED = "apps/desktop/src/shared/task-called.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
SESSION_RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"
PERSONSQUEUE = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
PERSONS_QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
QUEUEDMESSAGE = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
ROSTER = f"{LIB}/project-roster.ts"
REOPENING = f"{LIB}/reopening.ts"
ONE = f"{LIB}/one-read-at-a-time.ts"
PQ = f"{LIB}/persons-queue.ts"
RECORD = f"{LIB}/session-record.ts"
QUEUED = f"{COMPONENTS}/QueuedMessage.vue"
QUEUE = f"{COMPONENTS}/PersonsQueue.vue"
ROOM = f"{COMPONENTS}/ProjectWorkspace.vue"
SHEET = f"{COMPONENTS}/CapabilitiesSheet.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
RAIL = f"{COMPONENTS}/SideRail.vue"
NOTICE = f"{COMPONENTS}/NoticeEntry.vue"
COMPOSER = f"{COMPONENTS}/PromptComposer.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · one task, one name ─────────────────────────────────────────────────────────────
    (
        "M1 · ⚑ **the notice's bare number, back** · a question about work says *asked about #3* beside "
        "a card saying *Task #3*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a question about a piece is named on the transcript the way the card names it,
        # with no number of its own. `taskCalled(number)` is now the label the row carries, `asked
        # about ${event.label}`. The plant puts a bare `#` back in front of it. Killed by
        # `one-task-one-name.test.ts`, `one-task-one-name.dom.test.ts`.
        [
            (TRANSCRIPT, '`asked about ${event.label}`', '`asked about #${event.label}`'),
        ],
    ),
    (
        "M2 · ⚑ **the held words' bare number, back** · *on its task list as #4*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: held words whose work arrived read the piece's label, as `on its list as W1.4`.
        # `taskCalled(arrived)` is now the plain `{{ arrived }}`, which is `item.label`. The plant
        # puts a bare `#` in front of it. Killed by `one-task-one-name.test.ts`,
        # `one-task-one-name.dom.test.ts`.
        [
            (QUEUEDMESSAGE, 'on its list as {{ arrived }}', 'on its list as #{{ arrived }}'),
        ],
    ),
    (
        "M3 · ⚑ **the queue's bare number, back** · *This is about #12 in brobot2*",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The queue's spelling is
        # now `return taskCalled(work.number)` in `saidWork`, and the rule (one spelling, never a
        # bare `#N`) survives; `taskCalledIn` and the 'in <project>' tail are gone. Plant the bare
        # `#N` back on that line.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the person's queue says the piece by its label, not a number of its own.
        # `taskCalled(work.number)` is now `return work.label` in `saidWork`. The plant returns the
        # label behind a bare `#`. Killed by `one-task-one-name.test.ts`,
        # `one-task-one-name.dom.test.ts`.
        [
            (PERSONSQUEUE, '  return work.label\n', '  return `#${work.label}`\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The roster's own-project arm lived in
        # `lib/project-roster.ts`, which bd70d693 deletes along with the project room ('the project
        # rooms, board, sheet and picker ... are removed'). There is no roster, no bands headed by a
        # project, and no other band to draw a task in. Its anchor is left stale, so the census
        # records it retired.
        "M4 · ⚑ **the roster's own-project arm, a bare number** · *#3* in the band headed by its project",
        [(ROSTER, "said: elsewhere === null ? taskCalled(work.number) :",
          "said: elsewhere === null ? `#${String(work.number)}` :")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Drawing another project's task as this
        # project's needed the roster's `elsewhere` arm in the deleted `project-roster.ts`. D-016a
        # removes project rooms and 'Task #N in <project>', so the defect has no place left to
        # occur. Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ **another project's task drawn as this one's** · *Task #7* without its project, in a band "
        "whose heading names a different project",
        [(ROSTER, ": taskCalledIn(work.number, elsewhere),", ": taskCalled(work.number),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The roster template was in
        # `ProjectWorkspace.vue`, deleted by bd70d693 with the project room. The `task.said` cell it
        # planted a `#N` into does not exist any more. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⚑ **the roster template spells its own** · the row ignores `said` and prints `#N`",
        [(ROOM, "                        >{{ task.said }}</span", "                        >#{{ task.number }}</span")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted the project before the
        # number in `taskCalledIn`, which D-016a removes: 'Task #N in <project>' is gone and
        # `shared/task-called.ts` now has only `taskCalled`. No project is said with a task any
        # more, so there is no order to get wrong. Its anchor is left stale, so the census records
        # it retired.
        "M7 · ⚠️ **the project before the number** · *another-project Task #7* instead of *Task #7 in another-project*",
        [(CALLED, "  return `${taskCalled(number)} in ${projectSlug}`\n",
          "  return `${projectSlug} ${taskCalled(number)}`\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `.roster-task` style and its
        # explanatory block lived in `ProjectWorkspace.vue`, deleted with the project room. There is
        # no roster task left to draw in mono. Its anchor is left stale, so the census records it
        # retired.
        "M8 · ⚠️ **the code face back on the roster's task** · *Task #3* drawn like a reference in mono",
        [(ROOM, "/* ⚑ **672 · no rule of its own.** It was `--font-mono` while it held a bare `#3`, a reference drawn\n",
          ".roster-task {\n  font-family: var(--font-mono);\n}\n\n/* ⚑ **672 · no rule of its own.** It was `--font-mono` while it held a bare `#3`, a reference drawn\n")],
    ),
    # ── §2 · F5 · the grant sheet's reopen ──────────────────────────────────────────────────
    (
        "M9 · 🔴 **every row is the selected one** · the fold answers *selected* whenever anything is, so "
        "every other row is told it keeps a draft the close deletes",
        [(REOPENING, "        record.sessionId === selected\n", "        selected !== null\n")],
    ),
    (
        "M10 · 🔴 **the screen hands no selected id** · the selected row is told its draft is cleared, "
        "and it is the one row where it is not",
        [(SCREEN, "conversationsToReopen(store.open.value, overlay.profileSlug, activeId.value)",
          "conversationsToReopen(store.open.value, overlay.profileSlug, null)")],
    ),
    (
        "M11 · 🔴 **`656` F5, put back** · the sheet asks for the selected sentence on every row",
        [(SHEET, "reopeningSays(one.heldBy, one.arm)", "reopeningSays(one.heldBy, 'the-selected-conversation')")],
    ),
    (
        "M12 · 🔴 **the chooser ignores the arm** · `free` for every idle row",
        [(REOPENING, "  return heldBy === null ? freeSentence(arm) : REOPENING_SAYS[heldBy]\n",
          "  return REOPENING_SAYS[heldBy ?? 'free']\n")],
    ),
    (
        "M13 · 🔴 **the other arm's sentence gets the false clause back** · *keeps … whatever you have "
        "typed* on the row whose draft is deleted",
        [(REOPENING, "    'Reopening keeps the transcript, but anything typed or attached in its message box is cleared. ' +\n",
          "    'Reopening keeps the transcript and whatever you have typed. ' +\n")],
    ),
    (
        "M14 · ⛔ **the kept draft claims both arms** · the row loses its arm and is held to a sentence it "
        "is false on",
        [(REOPENING, "    what: 'what is typed in the message box',\n    arm: 'the-selected-conversation',\n",
          "    what: 'what is typed in the message box',\n")],
    ),
    (
        "M15 · ⚠️ **the sign-in bar handed the other arm** · the conversation on screen is told its draft "
        "is cleared",
        [(PANE, "reopeningSays(signInHeldBy.value, 'the-selected-conversation')",
          "reopeningSays(signInHeldBy.value, 'another-conversation')")],
    ),
    # ── §2 · F6 · the stale sign-in notice ──────────────────────────────────────────────────
    (
        "M16 · 🔴 **`656` F6, put back** · the notice names a Resume under *the closed threads*, which "
        "the rail has not had since `151`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-004 put a sentence before this one (the host
        # reopens by itself on a renewed login) and it now opens *"Otherwise, to carry on…"*. The
        # row puts back the same F6 words after that *"Otherwise,"*. Re-verified RED alone on
        # `transcript.test.ts`.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The closed list and its
        # Resume press are gone on purpose, but the rule survives: the stale sign-in notice must not
        # name a control that does not exist. D-017b's rewritten tests keep `not.toContain('sidebar'
        # / 'press it' / 'Resume' / 'closed threads')`, and no other row covers them. The new plant
        # adds the F6 Resume clause after the message remedy, so `toContain('send it a message to
        # carry on')` still passes and the red comes from the `sidebar` assertion.
        [
            (TRANSCRIPT, "'it a message to carry on: that reads", "'it a message to carry on, or press Resume on it under the closed threads in the sidebar: that reads"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protects a shared constant,
        # `CLOSED_CONVERSATIONS`, so the rail heading and the notice name the group the same way.
        # D-017b deleted the constant (with the import in transcript.ts), the Closed conversations
        # group and the heading `<span>` this row anchors. The commit says: 'One Conversations list
        # in the rail and the palette... no open / closed / kept-open split.' The rail heading is
        # now a plain literal 'Conversations', and no notice names the group. Its anchor is left
        # stale, so the census records it retired.
        "M17 · ⛔ **the heading spelled apart from its constant** · the rail and the notice name the group "
        "two ways again",
        [(RAIL, "          <span>{{ CLOSED_CONVERSATIONS }}</span>", "          <span>Closed threads</span>")],
    ),
    (
        "M18 · 🔴 **the reopen's two losses dropped** · the notice promises a reopen that brings back what "
        "it does not",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule still holds:
        # the stale sign-in notice must state the two losses of carrying on, the lost 'allow for
        # this session' approvals and the background work. D-017b reworded the tail from 'The
        # reopened conversation starts without…' to 'It carries on without…', so only the anchor
        # text moved. The new plant cuts the notice at 'expired too.'.
        [
            # ⚑ **always allow that recurs · re-anchored in place, not retired** — the conversation grant is named by its button's words, “Allow for this conversation”, as the card and Waiting on you say it; the plant still cuts the notice at 'expired too.'
            (TRANSCRIPT, "expired too. It carries on without its “Allow for this conversation” approvals or ' +\n  'anything that was running in the background.'\n", "expired too.'\n"),
        ],
    ),
    (
        "M19 · 🔴 **a notice a person acts on, cut to one line again** · the instruction is the part the "
        "ellipsis takes",
        [(NOTICE, ".notice-entry.warn .what {\n  white-space: normal;\n}", ".notice-entry.warn .what {\n  white-space: nowrap;\n}")],
    ),
    (
        "M20 · ⚠️ **the title that recovers a cut notice, gone** · an `info` notice past its column is "
        "unreadable",
        [(NOTICE, '      data-cy="what-the-notice-says"\n      :title="said"\n', '      data-cy="what-the-notice-says"\n')],
    ),
    (
        "M21 · ⚠️ **a warning left cut** · only `error` wraps",
        [(NOTICE, ".notice-entry.error .what,\n.notice-entry.warn .what {\n", ".notice-entry.error .what {\n")],
    ),
    # ── §3 · one read at a time ─────────────────────────────────────────────────────────────
    (
        "M22 · 🔴 **an ask during a read owes nothing** · the change announced after the read began is "
        "never read",
        [(ONE, "    owed = true\n    if (running !== null) return running\n",
          "    if (running !== null) return running\n    owed = true\n")],
    ),
    (
        "M23 · 🔴 **no coalescing** · every ask starts a read beside the one in flight — `668`'s burst",
        [(ONE, "    if (running !== null) return running\n", "")],
    ),
    (
        "M24 · 🔴 **the loop stops after two** · a change during the OWED read is not read",
        [(ONE, "      while (owed) {\n", "      if (owed) {\n")],
    ),
    (
        "M25 · ⚠️ **a failed read swallows the owed one** · the last change is dropped on an error",
        [(ONE, "          failed = { error }\n", "          failed = { error }\n          break\n")],
    ),
    (
        "M26 · ⚠️ **the last read's failure unreported** · a caller is told it landed",
        [(ONE, "      if (failed !== null) throw failed.error\n", "")],
    ),
    (
        "M27 · 🔴 **the screen's read unwrapped** · the Team page reads once per announcement again",
        [(SCREEN, "const readWhoIsWorking = oneReadAtATime(readWhoIsWorkingOnce)\n",
          "const readWhoIsWorking = readWhoIsWorkingOnce\n")],
    ),
    (
        "M28 · ⛔ **one trigger calls the bare read** · the tick puts a second read beside the burst's",
        # ⚑ W4.74 · re-anchored in place: the Team page's tick is gone (D-033), so the trigger that
        # calls the bare read is now arriving on the page — the same defect, one trigger over.
        [(SCREEN, "if (now === 'team') void readWhoIsWorking()",
          "if (now === 'team') void readWhoIsWorkingOnce()")],
    ),
    (
        "M29 · ⛔ **`running` set after the first read begins** · a read that wakes an ask synchronously "
        "puts a second read beside itself",
        [(ONE, "    running = mine\n    void drain().then(resolve, reject)\n",
          "    void drain().then(resolve, reject)\n    running = mine\n")],
    ),
    # ── the sweep · the ended composer, directly under the notice ────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'ended' composer state, and with
        # it the ended refusal that named the closed list, were removed on purpose. The commit's
        # diff to PromptComposer.vue removes `| 'ended'` and reads 'D-017b · there is no ended
        # conversation: every one takes a message'. The `CLOSED_CONVERSATIONS` import is gone too,
        # so no ended composer exists to refuse anything. Its anchor is left stale, so the census
        # records it retired.
        "M30 · ⚑ **the ended composer's refusal names *the rail* again** · a place no control is "
        "labelled, under a notice that names the heading",
        [(COMPOSER, "reopen it under ${CLOSED_CONVERSATIONS} in the sidebar to carry on (its row says why if it cannot be)`",
          "reopen it from the rail to carry on`")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The ended composer's hint template
        # ('This conversation has ended. Reopen it under {{ CLOSED_CONVERSATIONS }}…') was deleted
        # along with the 'ended' composer state. The card says: 'no sentence about whether anything
        # is running' and 'no End conversation button'. There is no ended composer left to carry the
        # hint. Its anchor is left stale, so the census records it retired.
        "M31 · ⚑ **the ended composer's hint names *the rail* again** · the second copy of the same "
        "sentence, one element over",
        [(COMPOSER, "Reopen it under {{ CLOSED_CONVERSATIONS }} in the sidebar to",
          "Reopen it from the rail to")],
    ),
    # ── what 672's review found unguarded ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016a: 'a task reads "Task #N"' and
        # 'Task #N in <project>' is removed, so a queue that spans projects and must say which
        # project no longer exists. The planted `Task #N` is now the correct text, and the plant
        # would go red only through the `taskCalled` spelling pin, which is the wrong reason. Its
        # anchor is left stale, so the census records it retired.
        "M32 · ⛔ **the queue's task without its project** · *Task #12* in a queue that spans projects — "
        "*a number alone names no task*",
        [(QUEUE, "  return taskCalledIn(work.number, work.projectSlug)\n",
          "  return `Task #${String(work.number)}`\n")],
    ),
    (
        "M33 · 🔴 **the free sentences swapped between arms** · the selected row is told its draft is "
        "cleared, every other row that it is kept",
        [(REOPENING, "REOPENING_SAYS[arm === 'the-selected-conversation' ? 'free' : 'free-another']",
          "REOPENING_SAYS[arm === 'the-selected-conversation' ? 'free-another' : 'free']")],
    ),
    (
        "M34 · ⚠️ **the notice drops the two clauses measured TRUE** · nothing says the reopen re-reads "
        "the login, or that an expired one will be named",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The two clauses measured
        # TRUE still ship in today's notice: the send 'reads your machine login again, and says so
        # if that login has expired too'. D-017b changed 'Reopening reads…' to 'send it a message to
        # carry on: that reads…', so only the anchor moved. The new plant cuts both clauses and
        # keeps the rest of the sentence intact.
        [
            (TRANSCRIPT, "carry on: that reads your machine login again, and says so if that login has ' +\n  'expired too. It carries on", 'carry on. It carries on'),
        ],
    ),
    (
        "M35 · ⛔ **an announcement arm calls the bare read** · a burst puts reads beside each other again",
        [(SCREEN, "      // Refresh the Team forest when a conversation opens, ends or is spawned, rather than waiting for arrival or its periodic tick. `readWhoIsWorking` runs only while the page is visible.\n      void readWhoIsWorking()\n",
          "      // Refresh the Team forest when a conversation opens, ends or is spawned, rather than waiting for arrival or its periodic tick. `readWhoIsWorking` runs only while the page is visible.\n      void readWhoIsWorkingOnce()\n")],
    ),
    # ── what 672's review found wrong ────────────────────────────────────────────────────────
    (
        "M36 · 🔴 **the stalled row's *Work #3*, back** · a third name for one task on the card whose "
        "question rows say *Task #3 in brobot2*",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The stalled row's
        # default arm still reads `${taskCalled(work.number)} with ...` (now without the project),
        # and 'a third name for one task' is still a live rule. Plant `Work #N` back on that line.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the stalled row names the piece by its label, so a third name for one piece (a
        # *Work #N* prefix) must not appear. `taskCalled(work.number)` is now `${work.label}` in the
        # default arm of `stalledWorkLead`, and the anchor takes the arm's preceding line to tell it
        # apart from the two sibling arms. The plant restores the `Work #` prefix. Killed by
        # `one-task-one-name.test.ts`, `one-task-one-name.dom.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule still holds. "One task, one name": the stalled row must not carry a `Work #N`
        # prefix, which is a third name for a task the question rows call `Task #N`.
        # `stalledWorkLead` in persons-queue.ts now has a single arm, `${work.label} with
        # ${work.ownerName} is not being worked on, and ${work.giverName} — which gave it out — has
        # not been told.` The commit removed the two R54 leads and the started-again lead, so the
        # old anchor no longer exists. The new anchor is that single template literal, and the plant
        # puts `Work #` in front of the label. Killed by `one-task-one-name.test.ts`,
        # `one-task-one-name.dom.test.ts`.
        [
            (PERSONS_QUEUE, 'export function stalledWorkLead(work: StalledWork): string {\n  return `${work.label} with', 'export function stalledWorkLead(work: StalledWork): string {\n  return `Work #${work.label} with'),
        ],
    ),
    (
        "M37 · 🔴 **a provider's error not marked as its words** · a response body wraps into a wall of "
        "the reading column",
        [(FOLD, "        notice(state, event.fatal ? 'error' : 'warn', shown, true)\n",
          "        notice(state, event.fatal ? 'error' : 'warn', shown)\n")],
    ),
    (
        "M38 · 🔴 **the provider's words marked and not clamped** · the wall again, one declaration over",
        [(NOTICE, "  -webkit-line-clamp: 3;\n", "")],
    ),
    (
        "M39 · ⚠️ **a read that throws at once hands its caller no promise** · `running` returned after "
        "the drain has already reset it",
        [(ONE, "    return mine\n  }\n}\n", "    return running\n  }\n}\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants 'and press it to reopen
        # it' in place of 'if it cannot be reopened, its row says why'. D-017b removed the press,
        # the closed row and its refusal note. It rewrote the notice as: 'A message sent from the
        # conversation's own view continues it, so that is what it says.' There is no row or refused
        # reopen to promise, and the test now asserts `not.toContain('press it')`. The remaining
        # defect, a press named at all, is covered by the re-anchored M16. Its anchor is left stale,
        # so the census records it retired.
        "M40 · ⚠️ **the notice promises a reopen that cannot happen** · no word for the row whose reopen "
        "is refused",
        [(FOLD, "and press it — if it cannot be reopened, its row says why. Reopening reads",
          "and press it to reopen it. Reopening reads")],
    ),
    (
        "M41 · ⚠️ **a missing-event sentence past one line** · the hairline `623` kept turns into a "
        "paragraph once a warning wraps",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # missing-event sentence must fit on ONE line, as
        # `the-event-that-did-not-arrive.dom.test.ts` measures with `lineCount`. D-017b dropped the
        # 'reopening it loads them from the record' remedy on purpose, since no press re-reads a
        # conversation now, and the sentence ends '…, so what you are reading is missing it/them.'.
        # The plant pads that new tail past the reading measure.
        [
            (SESSION_RECORD, ", so what you are reading is missing ${short === 1 ? 'it' : 'them'}.`", ", so what you are reading is missing ${short === 1 ? 'it' : 'them'} — it may still arrive, and this line will say so if it does; until then what you are reading stays incomplete, and the record holds every event this app was sent.`"),
        ],
    ),
]
