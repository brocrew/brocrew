"""718 · Compact now, and what main now carries — `R60`'s *"Compact now…"* after a confirm, `707`
GAP-2 to GAP-4 drawn, `710` F-5's take-over sentences (and a fourth the wider search found), `710` F-9's
start from the StartAsAgent sheet, and the renderer's half of the `:9555` confusion.

⚑ **The PM's §2:** the Dropped tab's control works on both providers, after a confirm, as the person's
`/compact` through the ordinary send; the sender's card, the Work tab and *Assigned by it* name a
task's project when it is not the reader's; three notices stop saying *"try again in a moment"*; a
refused start from the sheet is drawn where the person pressed; and a window on a non-default
userData says so in its title (the renderer's half — the fact is main's, `718` GAP-M1).

## 🔴 What has to be killable

 * `M1`–`M12` 🔴 **`R60`, the gate** (`compaction-offer.ts`): the control dark again; the press
   interrupting or sent NOW behind a turn; offered over a held message, a waiting card, an ended,
   closing or superseded conversation, one still opening, a capability not declared or unwired, or
   a drawer with no conversation; the busy sentence losing its *when*.
 * `M13`–`M27` 🔴 **`R60`, the door and its hops**: the button hard-coded dark; the press sending
   without asking; *Keep everything* sending; the question surviving a withdrawn offer, or a
   conversation switch; the lead word back to *Deferred.*; the drawer, the pane or the screen
   dropping the press or the facts; the pane's facts blind to a held message, a close or a sign-in;
   and the word the press sends.
 * `M28`–`M34` 🔴 **`707` GAP-2 / GAP-3 / GAP-4**: the receipt's `elsewhere` dropped or taken
   unchecked; the shared reader ignoring it; the Work tab and the band ignoring the reader's project,
   naming none or every one, or keeping the slug for a row at home.
 * `M35`–`M38` 🔴 **`710` F-5**: a take-over notice back to *"try again in a moment"*; the sentence
   losing its act; the reopen's own sentence back to *"— try again"*.
 * `M39`–`M49` 🔴 **`710` F-9**: the sheet's launch keyed as the front door's, its refusal written
   to the launcher, its retry keeping an old refusal, its Cancel stopping the other launch; the
   screen closing the sheet before asking, handing the sheet's words to the launcher, or drawing a
   refusal on a sheet that did not ask; the sheet never drawing its refusal, never handing the words
   back, never showing its launch, or its Cancel going nowhere.
 * `M50`–`M51` 🔴 **the `:9555` confusion, the renderer's half**: the page's title never following
   the bar's; a title written before the read lands.
 * `M65`–`M73` ⚠️ **found by `718`'s second review round**: the screen's own hops for a sheet
   launch (the sheet never learning the launch is its own, a gone sheet taken for one still up, the
   refusal never asked for or dropped, the sheet never closing on success); closing the sheet
   leaving its launch running, by any way of closing it; a waiting `/compact` read as a message to
   cancel.
 * `M52`–`M64` ⚠️ **found by `718`'s review**: a held message that is not the person's sent to a
   *Cancel it* the row does not draw, and the pane blind to whose it is; the confirm asking *now*
   over a queued answer, and staying open when the answer changes; a superseded sheet launch's
   refusal written onto the current one or handed to nobody; an opened launch closing another
   overlay, a gone sheet's refusal said nowhere or under the scrim; the sheet's own Cancel eating
   the words; a long project slug overflowing the band or the Work tab, or squeezing the name.

## ⛔ What this table cannot reach

 * ⚠️ **`RuntimeScreen` is mounted by no test** (`211` §11): its hops — the pane's `compactNow`, the
   take-over notices and `startPlaced` — are killed by censuses over their source.
 * ⚠️ **Whether this launch's userData is the default one** is main's to say, and was on no wire
   (`718` GAP-M1): no row here can make a title say it. ⚑ Since `724` main says it inside
   `windowTitle`, and its rows are `724`'s.
 * ⚠️ **The host's refusal of a `/compact`** is `708`'s and `713`'s; this table holds only what the
   window decides before the press.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, and no `mutations.txt` exists.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 made Compact queue behind a held message: M3 is retired (its defect became the decision), and
M52–M53 retire with the not-yours branch. ⚠️ M72 is still RED, but for a different defect than its
label names: with the generic *Cancel it* branch gone, the plant now OFFERS a second /compact. The
M1–M12 and M52–M64 bullets still describe the held-message refusal.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
RUNTIMESCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

OFFER = f"{LIB}/compaction-offer.ts"
CONTEXT = f"{COMPONENTS}/SessionContext.vue"
DRAWER = f"{COMPONENTS}/SessionDrawer.vue"
PANEL = f"{COMPONENTS}/SessionPanel.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
FOLD = f"{LIB}/transcript.ts"
RELAYED = f"{LIB}/relayed-turn.ts"
WORK = f"{LIB}/work-given-out.ts"
BAND = f"{LIB}/working-together.ts"
TAKING = f"{LIB}/taking-over.ts"
STORE = f"{LIB}/session-store.ts"
SHEET = f"{COMPONENTS}/StartAsAgent.vue"
TITLE = f"{COMPONENTS}/AppTitleBar.vue"
PLACED = f"{LIB}/placed-launch.ts"
TOGETHER = f"{COMPONENTS}/WorkingTogether.vue"
TASK_LIST = f"{COMPONENTS}/TaskList.vue"
WORK_TAB = f"{COMPONENTS}/SessionWork.vue"

NODE = "compact-now-and-what-main-now-carries.render.test.ts"
DRAWN = "compact-now-and-what-main-now-carries.dom.test.ts"

MUTATIONS = [
    # ── §1 · R60, the gate ───────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the control dark again** · an idle, live conversation is not offered the press — "
        f"killed by `{DRAWN}`",
        [
            (
                OFFER,
                "  return { offered: true, intent: 'now', why: road }\n",
                "  return notNow(road)\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **the press sent NOW behind a running turn** · not the composer's plain press — "
        f"killed by `{DRAWN}`",
        [(OFFER, "      intent: 'queue',\n", "      intent: 'now',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The row's defect is now the decision.
        # M3 planted 'Compact offered over a message already held', which the host used to refuse
        # (`MessageAlreadyHeld`). D-010 made that the intended behaviour. Its anchor is left stale,
        # so the census records it retired (`anchor-absent`).
        "M3 · 🔴 **offered over a message already held** · the plain press the host refuses "
        f"(`MessageAlreadyHeld`) — killed by `{DRAWN}`",
        [
            (
                OFFER,
                "  if (facts.state === 'busy' && facts.hasQueued) {\n",
                "  if (facts.state === 'busy' && facts.hasQueued && false) {\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **offered while a card waits on the person** · a message cannot answer it — "
        f"killed by `{DRAWN}`",
        [(OFFER, "  if (facts.state === 'frozen') {\n", "  if (facts.state === 'frozen' && false) {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `ended` composer state was
        # removed: `CompactionFacts.state` is now 'idle'|'busy'|'starting'|'frozen', the `ended`
        # branch in compaction-offer.ts is gone, and the test's section 1 says 'four states, not
        # five' because there is no ended conversation. Its anchor is left stale, so the census
        # records it retired.
        "M5 · 🔴 **offered on an ended conversation** — killed by " f"`{DRAWN}`",
        [(OFFER, "  if (facts.state === 'ended') {\n", "  if (facts.state === 'ended' && false) {\n")],
    ),
    (
        "M6 · 🔴 **offered on a conversation that is closing** — killed by " f"`{DRAWN}`",
        [
            (
                OFFER,
                "  if (facts.closing) return notNow(",
                "  if (facts.closing && false) return notNow(",
            )
        ],
    ),
    (
        "M7 · 🔴 **offered over a superseded sign-in** · no message goes out on it — killed by "
        f"`{DRAWN}`",
        [
            (
                OFFER,
                "  if (facts.signInSuperseded) {\n",
                "  if (facts.signInSuperseded && false) {\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **offered while the conversation is still opening** — killed by " f"`{NODE}`",
        [
            (
                OFFER,
                "  if (facts.state === 'starting') return notNow('This conversation is still opening.')\n",
                "",
            )
        ],
    ),
    (
        "M9 · ⛔ **offered on a capability that was never read** · the read failed and the press is "
        f"live anyway — killed by `{DRAWN}`",
        [
            (
                OFFER,
                "  if (capability === null) return { offered: false, lead: NOT_OFFERED, why: NOT_DECLARED }\n",
                "  if (capability === null) return { offered: true, intent: 'now', why: NOT_DECLARED }\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **an `unwired` capability read as `available`** · only `absent` withholds — killed "
        f"by `{NODE}`",
        [
            (
                OFFER,
                "  if (capability.state !== 'available') {\n",
                "  if (capability.state === 'absent') {\n",
            )
        ],
    ),
    (
        "M11 · ⛔ **offered on a drawer with no conversation behind it** · a press with no send door "
        f"to reach — killed by `{NODE}`",
        [
            (
                OFFER,
                "  if (facts === null) return notNow(`${road} This view has no conversation to send it to.`)\n",
                "  if (facts === null) return { offered: true, intent: 'now', why: road }\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **the busy sentence loses its *when*** · the press queues and nothing says so "
        f"before it — killed by `{DRAWN}`",
        [
            (
                OFFER,
                "      why: `${road} ${facts.who} is working, so it goes when this turn ends.`,\n",
                "      why: road,\n",
            )
        ],
    ),
    # ── §1b · R60, the door and its hops ─────────────────────────────────────────────────────────
    (
        "M13 · 🔴 **the button hard-coded dark again** · `087` to `713`'s `disabled` — killed by "
        f"`{DRAWN}`",
        [(CONTEXT, '        :disabled="!offer.offered"\n', "        disabled\n")],
    ),
    (
        "M14 · 🔴 **the press sends without asking** · no confirm in front of an irreversible act — "
        f"killed by `{DRAWN}`",
        [
            (
                CONTEXT,
                "  confirming.value = true\n  void nextTick(",
                "  emit('compactNow', offer.value.offered ? offer.value.intent : 'now')\n  void nextTick(",
            )
        ],
    ),
    (
        "M15 · ⛔ **a withdrawn question comes back by itself** · the offer returns and the door "
        f"reopens with nobody asking — killed by `{DRAWN}`",
        # ⚑ Re-pointed by `718`'s second review round: the separate withdrawal watch was redundant (the
        # intent watch reads `null` for a withdrawn offer) and was deleted; this plants the same defect
        # in the one watch left — a withdrawal no longer counts as a change.
        [
            (
                CONTEXT,
                "  () => (offer.value.offered ? offer.value.intent : null),\n",
                "  () => (offer.value.offered ? offer.value.intent : 'now'),\n",
            )
        ],
    ),
    (
        "M16 · ⛔ ***Keep everything* compacts** · the two answers do the same thing — killed by "
        f"`{DRAWN}`",
        [(CONTEXT, '            @click="confirming = false"\n', '            @click="compactIt"\n')],
    ),
    (
        "M17 · 🔴 **the lead back to *Deferred.*** · a withheld press says the `713` word — killed "
        f"by `{DRAWN}`",
        [
            (
                CONTEXT,
                '<b v-if="!offer.offered">{{ offer.lead }}</b>',
                '<b v-if="!offer.offered">Deferred.</b>',
            )
        ],
    ),
    (
        "M18 · 🔴 **the Context popup outlives its conversation** · an open question answers for the "
        f"next conversation — killed by `{DRAWN}`",
        # ⚑ **W4.208 · re-anchored in place, not retired** — the Context tab was keyed by
        # conversation; its meter is the Context popup now, which the panel shuts when the
        # conversation changes. The plant keeps the watch and drops what it does.
        [
            (
                PANEL,
                "  () => props.conversation,\n  () => {\n    agent.contextDialogOpen.value = false\n  },\n",
                "  () => props.conversation,\n  () => {},\n",
            )
        ],
    ),
    (
        "M19 · 🔴 **the panel never relays the popup's press** — killed by " f"`{DRAWN}`",
        [
            (
                PANEL,
                # ⚑ **W4.188 · re-anchored in place, not retired** — W4.188 · 85caae17 added a second identical relay on AgentCard (the card's Compact door). ⚑ **W4.208 · and again**: the Dropped tab's SessionContext relay is the Context popup's now, relayed by SessionPanel, which its killer compact-now-and-what-main-now-carries.dom.test.ts presses (context-compact-now in the popup).
                "            agent.contextDialogOpen.value = false\n            emit('compactNow', intent)\n",
                "            agent.contextDialogOpen.value = false\n",
            )
        ],
    ),
    (
        "M20 · 🔴 **the pane never relays the press** — killed by " f"`{DRAWN}`",
        [
            (
                PANE,
                "        @compact-now=\"(intent) => emit('compactNow', intent)\"\n",
                "",
            )
        ],
    ),
    (
        "M21 · 🔴 **the pane never hands the drawer its facts** · the control is dark on every live "
        f"conversation — killed by `{DRAWN}`",
        [(PANE, '        :compaction="compaction"\n', "")],
    ),
    (
        "M22 · 🔴 **the pane's facts are blind to a held message** — killed by " f"`{DRAWN}`",
        [(PANE, "  hasQueued: hasQueued.value,\n", "  hasQueued: false,\n")],
    ),
    (
        "M23 · 🔴 **the pane's facts are blind to a close in flight** — killed by " f"`{DRAWN}`",
        [
            (
                PANE,
                "  closing: props.record.phase === 'closing',\n",
                "  closing: false,\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **the pane's facts are blind to a superseded sign-in** — killed by " f"`{DRAWN}`",
        [(PANE, "  signInSuperseded: signInSuperseded.value,\n", "  signInSuperseded: false,\n")],
    ),
    (
        "M25 · 🔴 **the screen sends nothing on the answer** · the press is confirmed and goes "
        f"nowhere — killed by `{NODE}`",
        [(SCREEN, "  void store.send(sessionId, THE_COMPACT_COMMAND, intent, [])\n", "")],
    ),
    (
        "M26 · 🔴 **the screen never listens to the pane's press** — killed by " f"`{NODE}`",
        [(SCREEN, '          @compact-now="compactNow"\n', "")],
    ),
    (
        "M27 · ⛔ **the press sends words Codex refuses** · `/compact` with instructions — killed by "
        f"`{NODE}`",
        [
            (
                OFFER,
                "export const THE_COMPACT_COMMAND = '/compact'\n",
                "export const THE_COMPACT_COMMAND = '/compact now'\n",
            )
        ],
    ),
    # ── §2 · 707 GAP-2 / GAP-3 / GAP-4 ───────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `elsewhere` was deleted from
        # `message_sent` receipts and from the transcript fold (no `event.elsewhere` left in
        # transcript.ts). Commit message: 'a task reads "Task #N"'. Its anchor is left stale, so the
        # census records it retired.
        "M28 · 🔴 **the receipt's `elsewhere` dropped by the fold** · the sender's card says *Task #1* "
        f"for beta's — killed by `{DRAWN}`",
        [
            (
                FOLD,
                "                      ...(isAnId(event.elsewhere) ? { elsewhere: event.elsewhere } : {}),\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `isAnId(event.elsewhere)` guard is
        # gone with the `elsewhere` field itself. A receipt can no longer spell 'Task #1 in
        # <project>'. Its anchor is left stale, so the census records it retired.
        "M29 · ⛔ **the receipt's `elsewhere` taken unchecked** · an empty or wrong-typed field spells "
        f"*Task #1 in * — killed by `{NODE}`",
        [
            (
                FOLD,
                "...(isAnId(event.elsewhere) ? { elsewhere: event.elsewhere } : {}),",
                "...(event.elsewhere !== undefined ? { elsewhere: event.elsewhere as string } : {}),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `openedTaskSays` now takes `{ number?:
        # number }` and returns `taskCalled(opened.number)`; the `elsewhere` branch and
        # `taskCalledIn` were removed on purpose ('a task reads "Task #N"'). Its anchor is left
        # stale, so the census records it retired.
        "M30 · 🔴 **the shared reader ignores `elsewhere`** — killed by " f"`{NODE}`",
        [
            (
                RELAYED,
                "  return opened.elsewhere === undefined\n",
                "  return opened.elsewhere === undefined || true\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** work-given-out.ts no longer computes
        # `elsewhere` or calls `projectElsewhere`; its row is `workReading(row, 'now')`, the plant's
        # own replacement text. The Work tab spelling a project is the removed *Task #N in
        # <project>* behaviour. Its anchor is left stale, so the census records it retired.
        "M31 · 🔴 **the Work tab never spells a project** · `707` GAP-3 reopened — killed by "
        f"`{DRAWN}`",
        [
            (
                WORK,
                "    ...workReading(elsewhere === null ? row : { ...row, elsewhere }, 'now'),\n",
                "    ...workReading(row, 'now'),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `readersProject` and
        # `WorkGivenOutRead` were removed; the walk is now a plain `LedgerWalk<WorkGivenOut>` and
        # rows are built with `rowOf(row, input)`. There is no reader-project comparison left to
        # skip. Its anchor is left stale, so the census records it retired.
        "M32 · 🔴 **the Work tab asks no reader** · every row names its project, the reader's own "
        f"included — killed by `{NODE}`",
        [
            (
                WORK,
                "  const readersProject = reading.walk.readersProject ?? null\n",
                "  const readersProject = null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** working-together.ts no longer builds
        # `elsewhere` for a band row, so `reading: workReading(row, 'now')` is now the real code.
        # The band spelling a project is the deleted *Task #N in <project>* behaviour. Its anchor is
        # left stale, so the census records it retired.
        "M33 · 🔴 **the band never spells a project** · `707` GAP-4 reopened — killed by "
        f"`{DRAWN}`",
        [
            (
                BAND,
                "    reading: workReading(elsewhere === null ? row : { ...row, elsewhere }, 'now'),\n",
                "    reading: workReading(row, 'now'),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `readersProject` and the `project:
        # elsewhere` field on the band row are removed. The 'slug at home' defect is the per-project
        # split that D-016a deleted. Its anchor is left stale, so the census records it retired.
        "M34 · 🔴 **the band asks no reader, and keeps the slug at home** — killed by " f"`{NODE}`",
        [
            (
                BAND,
                "  const readersProject = read.readersProject ?? null\n",
                "  const readersProject = null\n",
            ),
            (BAND, "    project: elsewhere,\n", "    project: row.projectSlug,\n"),
        ],
    ),
    # ── §3 · 710 F-5 ─────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `takeOver` and
        # `HANDED_BACK_AS_IT_WAS_TAKEN` are deleted: the Reopen, Take it over and Read the recording
        # presses became one press, `OPEN_THE_CONVERSATION`, through `openConversation`. The
        # compact-now render test now asserts neither name exists in RuntimeScreen. Its anchor is
        # left stale, so the census records it retired.
        "M35 · 🔴 **the take-over press back to *try again in a moment*** — killed by " f"`{NODE}`",
        [
            (
                SCREEN,
                "  // reported the same way rather than silently selecting an id that resolves to nothing.\n"
                "  if (store.get(sessionId) === null) {\n"
                "    say(HANDED_BACK_AS_IT_WAS_TAKEN)\n",
                "  // reported the same way rather than silently selecting an id that resolves to nothing.\n"
                "  if (store.get(sessionId) === null) {\n"
                "    say('That conversation is being taken over — try again in a moment.')\n",
            )
        ],
    ),
    (
        "M36 · 🔴 **the Waiting-on-you press back to *try again in a moment*** — killed by "
        f"`{NODE}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The presses go through
        # one door and must say the host's refusal, never 'try again' (standing rule 8.4);
        # `goToQuestion` still begins with `if (!(await openConversation(row.sessionId))) return`.
        # The plant puts a try-again sentence on that failure path, which is what the compact-now
        # section 4 test pins by reading the body.
        [
            (RUNTIMESCREEN, '  if (!(await openConversation(row.sessionId))) return\n', "  if (!(await openConversation(row.sessionId))) {\n    say('That conversation is being taken over — try again in a moment.')\n    return\n  }\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The sentence 'It is still running —
        # press it again to open it' said whether a process runs, and D-017b deleted every such
        # sentence (05 rule 5) along with the take-over press it belonged to. The one press now
        # opens the conversation and the host answers with its own refusal. Its anchor is left
        # stale, so the census records it retired.
        "M37 · 🔴 **the sentence loses its act** · what happened, and nothing a person can press — "
        f"killed by `{NODE}`",
        [
            (
                TAKING,
                "It is still running — press it again to open it.'",
                "It is still running.'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `ENDED_AS_IT_REOPENED` and the branch
        # in `resume` that set it were deleted: `resume` now ends `return sessions.get(opened) ===
        # into ? opened : null`, and the compact-now test says there is no refusal left to word. The
        # 'ended' state it worded no longer exists. Its anchor is left stale, so the census records
        # it retired.
        "M38 · 🔴 **the reopen's own refusal back to *— try again*** · the fourth, found by the wider "
        f"search — killed by `{NODE}`",
        [
            (
                STORE,
                "          resumeError.value = ENDED_AS_IT_REOPENED\n",
                "          resumeError.value =\n"
                "            'this conversation was handed back but could not be reopened here — try again'\n",
            )
        ],
    ),
    # ── §4 · 710 F-9 ─────────────────────────────────────────────────────────────────────────────
    (
        "M39 · 🔴 **the sheet's launch keyed as the front door's** · the launcher shows a start it "
        f"did not make, and its Cancel stops the sheet's — killed by `{NODE}`",
        [
            (
                STORE,
                "        door === 'sheet' ? PLACED_LAUNCH : NEW_LAUNCH,\n",
                "        NEW_LAUNCH,\n",
            )
        ],
    ),
    (
        "M40 · 🔴 **the sheet's refusal written to the launcher** · drawn where the person was not — "
        f"killed by `{NODE}`",
        [
            (
                STORE,
                "        door === 'sheet' ? placedError : launchError,\n",
                "        launchError,\n",
            )
        ],
    ),
    (
        "M41 · ⛔ **a retry keeps the sheet's last refusal** · beside its own spinner — killed by "
        f"`{NODE}`",
        [(STORE, "    resumeError.value = null\n    placedError.value = null\n", "    resumeError.value = null\n")],
    ),
    (
        "M42 · 🔴 **the sheet's Cancel stops the front door's launch** — killed by " f"`{NODE}`",
        [
            (
                STORE,
                "    cancelPlaced: () => cancelGesture(PLACED_LAUNCH),\n",
                "    cancelPlaced: () => cancelGesture(NEW_LAUNCH),\n",
            )
        ],
    ),
    (
        "M43 · 🔴 **the screen closes the sheet before asking** · the refusal has nowhere to land — "
        f"killed by `{NODE}`",
        [
            (
                SCREEN,
                "  void start(input, firstMessage, attachments, 'sheet', {\n",
                "  overlays.close()\n  void start(input, firstMessage, attachments, 'sheet', {\n",
            )
        ],
    ),
    (
        "M44 · 🔴 **the screen hands the sheet's words to the launcher** — killed by " f"`{NODE}`",
        [(SCREEN, "    if (door === 'sheet') return\n", "")],
    ),
    (
        "M45 · 🔴 **a refusal drawn on a sheet that did not ask** · a new sheet wears the last one's "
        f"— killed by `{NODE}`",
        [
            (
                SCREEN,
                ':error="placedHere ? store.placedError.value : null"',
                ':error="store.placedError.value"',
            )
        ],
    ),
    (
        "M46 · 🔴 **the sheet never draws its refusal** · `710` F-9's *shows nowhere* — killed by "
        f"`{DRAWN}`",
        [
            (
                SHEET,
                '<div v-if="props.error" class="blocker" data-cy="start-as-agent-refused">',
                '<div v-if="false" class="blocker" data-cy="start-as-agent-refused">',
            )
        ],
    ),
    (
        "M47 · 🔴 **the sheet never hands the words back** · a refused start takes what was typed — "
        f"killed by `{DRAWN}`",
        [(SHEET, "      words.value = lastTried\n", "      void lastTried\n")],
    ),
    (
        "M48 · 🔴 **the sheet never shows its launch** · a press, and nothing on screen until it "
        f"answers — killed by `{DRAWN}`",
        [(SHEET, "      :state=\"props.busy ? 'starting' : 'idle'\"\n", '      state="idle"\n')],
    ),
    (
        "M49 · 🔴 **the sheet's Cancel goes nowhere** · `106`'s control that cannot act — killed by "
        f"`{DRAWN}`",
        [(SHEET, '      @interrupt="cancel"\n', "")],
    ),
    # ── §5 · the :9555 confusion, the renderer's half ────────────────────────────────────────────
    (
        "M50 · 🔴 **the page's title never follows the bar's** · the OS keeps saying *BroBot2* — "
        f"killed by `{DRAWN}`",
        [
            (
                TITLE,
                "    if (title !== null && typeof document !== 'undefined') document.title = title\n",
                "    void title\n",
            )
        ],
    ),
    (
        "M51 · ⛔ **a title written before the read lands** · the page's own name replaced by "
        f"nothing — killed by `{DRAWN}`",
        [
            (
                TITLE,
                "    if (title !== null && typeof document !== 'undefined') document.title = title\n",
                "    if (typeof document !== 'undefined') document.title = title ?? ''\n",
            )
        ],
    ),
    # ── §6 · found by 718's review ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject is gone. M52 disabled the
        # not-yours branch (`facts.notYoursIsWaiting`) that kept the drawer from pointing at a
        # *Cancel it* the row does not draw (688 R22). Its anchor is left stale, so the census
        # records it retired (`anchor-absent`).
        "M52 · 🔴 **a held message the person did not write is theirs to cancel** · the drawer points at "
        f"a *Cancel it* the row does not draw (`688` R22) — killed by `{DRAWN}`",
        [
            (
                OFFER,
                "  if (facts.state === 'busy' && facts.hasQueued && facts.notYoursIsWaiting) {\n",
                "  if (facts.state === 'busy' && facts.hasQueued && facts.notYoursIsWaiting && false) {\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject is gone. M53 blinded the
        # pane's compaction facts to whose message is held (`notYoursIsWaiting:
        # notYoursIsWaiting.value`). Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M53 · 🔴 **the pane's facts are blind to whose message is held** — killed by " f"`{DRAWN}`",
        [(PANE, "  notYoursIsWaiting: notYoursIsWaiting.value,\n", "  notYoursIsWaiting: false,\n")],
    ),
    (
        "M54 · 🔴 **the confirm asks *now* when the answer queues** — killed by " f"`{DRAWN}`",
        [
            (
                OFFER,
                "  return intent === 'queue' ? COMPACT_HEADING_AFTER_THE_TURN : COMPACT_HEADING\n",
                "  return COMPACT_HEADING\n",
            )
        ],
    ),
    (
        "M55 · ⛔ **a question asked as *now* stays open over a *queue* answer** · the agent started "
        f"working while the door was open — killed by `{DRAWN}`",
        [(CONTEXT, "    if (intent !== before) confirming.value = false\n", "    void [intent, before]\n")],
    ),
    (
        "M56 · 🔴 **a superseded launch's refusal is written into the current one's ref** · drawn "
        f"beside another sheet's spinner — killed by `{NODE}`",
        [
            (
                STORE,
                "        if (inFlight.get(gesture) === key) into.value = said\n",
                "        into.value = said\n",
            )
        ],
    ),
    (
        "M57 · 🔴 **a launch's refusal is never handed to the caller that asked** · a sheet closed "
        f"mid-launch is told nothing — killed by `{NODE}`",
        [(STORE, "        refused?.(said)\n", "")],
    ),
    (
        "M58 · 🔴 **an opened launch closes whatever overlay is up** · a fresh sheet mid-typing — "
        f"killed by `{NODE}`",
        [
            (
                PLACED,
                "  if (ended.kind === 'opened') return { close: sheetStillThere, notice: null }\n",
                "  if (ended.kind === 'opened') return { close: true, notice: null }\n",
            )
        ],
    ),
    (
        "M59 · 🔴 **a refusal whose sheet is gone is said nowhere** · F-9's defect, one state over — "
        f"killed by `{NODE}`",
        [
            (
                PLACED,
                "  return { close: false, notice: sheetStillThere ? null : ended.sentence }\n",
                "  return { close: false, notice: null }\n",
            )
        ],
    ),
    (
        "M60 · 🔴 **the closed sheet's refusal painted under the scrim** · the frame's own toast — "
        f"killed by `{NODE}`",
        [
            (
                SCREEN,
                "    if (notice !== null) overlays.notify(notice)\n",
                "    if (notice !== null) say(notice)\n",
            )
        ],
    ),
    (
        "M61 · 🔴 **the sheet's own Cancel eats the words** · `015`'s defect at the second door — "
        f"killed by `{DRAWN}`",
        [
            (
                SHEET,
                "    const cancelledWithWords = settled && cancelledHere && lastTried !== '' && words.value === ''\n",
                "    const cancelledWithWords = false\n",
            )
        ],
    ),
    (
        "M62 · ⛔ **the band's number cannot give way** · a long slug pushes the line past the "
        f"column — killed by `{DRAWN}`",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `9b4b5a8e` moved `.tnum` and its
        # comment into TaskList.vue unchanged.
        [(TASK_LIST, "  min-width: 5em;\n  flex: 0 1000 auto;\n", "  min-width: 5em;\n  flex: 0 0 auto;\n")],
    ),
    (
        "M63 · ⛔ **an even share squeezes the recipient** · the name clipped beside a long slug — "
        f"killed by `{DRAWN}`",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `a03bf2f0` took the recipient's
        # name off the lines this conversation gave out, but a line given TO it still names its
        # giver beside the number (`showsWho`). The landing added that line's test to the killer
        # file (`the longest slug on a line given TO it keeps the giver named on the line`).
        [(TASK_LIST, "  min-width: 5em;\n  flex: 0 1000 auto;\n", "  min-width: 0;\n  flex: 0 1 auto;\n")],
    ),
    (
        "M64 · ⛔ **the Work tab's heading cannot break a long slug** · the row widens past its "
        f"column — killed by `{DRAWN}`",
        [(WORK_TAB, "  font-weight: var(--fw-bold);\n  overflow-wrap: anywhere;\n", "  font-weight: var(--fw-bold);\n")],
    ),
    # ── §7 · found by 718's second review round ─────────────────────────────────────────────────
    (
        "M65 · 🔴 **the sheet never learns the launch is its own** · no `starting`, no Cancel, no "
        f"refusal box — `710` F-9 whole — killed by `{NODE}`",
        [(SCREEN, "  placedFrom.value = sheet\n", "")],
    ),
    (
        "M66 · 🔴 **a sheet that is gone is taken for one still up** · a refusal said nowhere, another "
        f"overlay closed — killed by `{NODE}`",
        [
            (
                SCREEN,
                "  const stillThere = (): boolean => sheet !== null && overlays.overlay.value === sheet\n",
                "  const stillThere = (): boolean => sheet !== null\n",
            )
        ],
    ),
    (
        "M67 · 🔴 **the screen never asks for this launch's refusal** · a gone sheet is told nothing — "
        f"killed by `{NODE}`",
        [
            (
                SCREEN,
                "  const sessionId = await store.create(input, door, told.refused)\n",
                "  const sessionId = await store.create(input, door)\n",
            )
        ],
    ),
    (
        "M68 · 🔴 **the sheet never closes when its conversation opens** — killed by " f"`{NODE}`",
        [(SCREEN, "  told.opened?.()\n", "")],
    ),
    (
        "M69 · 🔴 **the refusal handed back is dropped on the floor** — killed by " f"`{NODE}`",
        [(SCREEN, "      refusal = sentence\n", "      void sentence\n")],
    ),
    (
        "M70 · 🔴 **closing the sheet leaves its launch running** · nothing can cancel it, and a refusal "
        f"takes the words — killed by `{NODE}`",
        [
            (
                SCREEN,
                "  if (placedHere.value && store.isPlacing()) void store.cancelPlaced()\n",
                "",
            )
        ],
    ),
    (
        "M71 · 🔴 **Esc and the backdrop skip the rule** · the host closes without cancelling — killed "
        f"by `{NODE}`",
        [
            (
                SCREEN,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the screen's overlay host now names its dialog and spans several lines; the plant still closes on Esc and the backdrop without the cancelling rule
                "        :label=\"overlayLabel(overlays.overlay.value)\"\n        @close=\"closeOverlay()\"\n",
                "        :label=\"overlayLabel(overlays.overlay.value)\"\n        @close=\"overlays.close()\"\n",
            )
        ],
    ),
    (
        "M72 · 🔴 **a waiting /compact is a message to cancel** · the person told to cancel their own "
        f"compaction *to compact* — killed by `{DRAWN}`",
        [
            (
                OFFER,
                "  if (facts.state === 'busy' && facts.hasQueued && facts.compactionIsWaiting) {\n",
                "  if (facts.state === 'busy' && facts.hasQueued && facts.compactionIsWaiting && false) {\n",
            )
        ],
    ),
    (
        "M73 · 🔴 **the pane never sees its own /compact held** — killed by " f"`{DRAWN}`",
        [
            (
                PANE,
                "      held.text.trim().split(/\\s/)[0] === THE_COMPACT_COMMAND,\n",
                "      held.text.trim().split(/\\s/)[0] === 'never',\n",
            )
        ],
    ),
]
