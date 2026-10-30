"""667 · The three sentences beside the new cards.

⚑ **`658`'s own hand-backs G3, G4 and G5, all renderer-side.** the person liked the cards; three sentences
a person reads beside them were still wrong:

 * **G3** — a lost reply's notice read *"the reply to task_… did not reach sess_…: no-conversation"*.
   It now reads *"the reply to Task #3 did not reach Pam: that conversation was not running"* —
   `lib/lost-reply.ts`, with the reason's words exhaustive over main's undelivered answers.
 * **G4** — a recording headed its cards with the PROVIDER (*"ada to claude"*) and a child's work
   with *"sub-agent"*. A card is now handed the agent's NAME or `null` (`ownAgent`), and `null` reads
   *this conversation*.
 * **G5** — an unnamed agent launched as `Dev` read *"dev to Dev"* on one card. The pane, the
   drawer, the rail and the closed-thread list now ask `agentName` through `oneSpelling`.

## 🔴 What has to be killable

 * `M1`–`M8` ⚑ **G3**: the old notice back; a name borrowed from another task-giver; a prototype
   member accepted as a reason; an unknown word printed; the roster ignored by the sentence, by the
   row, and by the transcript; the task named by a bare number.
 * `M9`, `M10` 🔴 **G5**: the fold removed; the reply heading derived a second time, unfolded.
 * `M11`–`M15` ⛔ **G4**: the heading word handed to a card as a name (a relay, an outgoing call);
   the live pane handing no name; the recording handed no roster, at the pane and at the screen.
 * `M16`, `M17` ⚑ **G4, the other two cards**: the heading word handed to a work report and to a held
   row — found untested by `667`'s review.
 * `M18`–`M20` 🔴 **G5, the surfaces beside the pane**: the drawer's plate, the rail's row and the
   closed-thread list asked in the directory spelling — the review found the drawer disagreeing
   with the pane that mounts it.
 * `M21` ⚠️ a held relay's recipient falling back to a PROVIDER, where the held reply's does not —
   one card that draws the side twice.
 * `M22` ⛔ the fold crashing on a record with no profile — which `667`'s first cut did, and the
   rail's own DOM tests caught.

## ⛔ What this table cannot reach

 * ⚠️ **No row for `taskCalled` itself** (`work-report.ts`): it is the work report's heading, and a
   change there is killed by every `406`/`658` test that reads *Task #N* — `M8` breaks the one
   caller `667` added instead.
 * ⚠️ **No row for the `number` spread in the fold.** An absent number and an `undefined` one read
   the same sentence, so no test can tell them apart — the spread is shape, not behaviour.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
individually — one row, its killer file, restore-from-bytes — in an isolated worktree, never the
tree the person's dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
LOST_REPLY = "apps/desktop/src/renderer/src/lib/lost-reply.ts"

TRANSCRIPT = f"{LIB}/transcript.ts"
LOST_REPLY = f"{LIB}/lost-reply.ts"
NOTICE = f"{COMPONENTS}/NoticeEntry.vue"
VIEW = f"{COMPONENTS}/TranscriptView.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
READING = f"{COMPONENTS}/ReadingPane.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
DRAWER = f"{COMPONENTS}/SessionDrawer.vue"
RAIL = f"{COMPONENTS}/SideRail.vue"
CLOSED = f"{LIB}/closed-threads.ts"
QUEUED = f"{COMPONENTS}/QueuedMessage.vue"
SPELLING = f"{LIB}/one-spelling.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **the old notice, back** · *\"the reply to task_… did not reach sess_…: "
        "no-conversation\"* — an id, a handle and a closed word beside a card that said all three in "
        "words",
        [
            (
                TRANSCRIPT,
                "        text: lostReplySentence(lost, null),\n        lostReply: lost,\n",
                "        text: `the reply to ${event.taskId} did not reach ${event.parent}: "
                "${String(event.because)}`,\n",
            )
        ],
    ),
    (
        "M2 · ⛔ **a name borrowed from another task-giver** · a row naming a different parent is "
        "headed with the name on this task's assignment",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a lost-reply notice takes the parent's name only from a give whose giver is THIS
        # reply's parent, and never borrows another conversation's. The fold now compares
        # giver.conversation against event.parent in the reply_undelivered case, keyed by piece, and
        # the killer was updated in 5e931be8. Only the first operand changed (== null became ===
        # undefined). Killed by `the-three-sentences-beside-the-cards.test.ts`.
        [
            (TRANSCRIPT, '        ...(giver?.profile === undefined || giver.conversation !== event.parent\n', '        ...(giver?.profile === undefined\n'),
        ],
    ),
    (
        "M3 · ⚠️ **a prototype member read as a reason** · `in` answers yes for `toString`, and a "
        "row from a later build prints a function's source",
        [
            (
                LOST_REPLY,
                "Object.hasOwn(UNDELIVERED_REASON_WORDS, word)",
                "word in UNDELIVERED_REASON_WORDS",
            )
        ],
    ),
    (
        "M4 · 🔴 **an unknown word taken on trust** · a reason this build has no words for prints "
        "*undefined* where the sentence should stop",
        [
            (
                TRANSCRIPT,
                "        because: isUndeliveredReason(event.because) ? event.because : null,\n",
                "        because: (event.because ?? null) as LostReply['because'],\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **the roster ignored by the sentence** · the parent is its slug, *project-manager*, "
        "where the card above names *Pam*",
        [
            (
                LOST_REPLY,
                "lost.toProfile === undefined ? AN_UNNAMED_PARENT : agentName(lost.toProfile, identities)",
                "lost.toProfile === undefined ? AN_UNNAMED_PARENT : lost.toProfile",
            )
        ],
    ),
    (
        "M6 · ⚑ **the row draws the fold's roster-less text** · the transcript never asks the "
        "sentence with the roster it holds",
        [
            (
                NOTICE,
                "    : lostReplySentence(props.item.lostReply, props.identities ?? null),\n",
                "    : props.item.text,\n",
            )
        ],
    ),
    (
        "M7 · ⚑ **the transcript hands the notice no roster** · the same slug, one hop up",
        [
            (
                VIEW,
                "          v-else-if=\"row.item.kind === 'notice'\"\n          :item=\"row.item\"\n"
                "          :identities=\"props.identities ?? null\"\n",
                "          v-else-if=\"row.item.kind === 'notice'\"\n          :item=\"row.item\"\n",
            )
        ],
    ),
    (
        "M8 · ⚠️ **the task named by a bare number** · *\"the reply to #3\"* beside a card saying "
        "*Task #3* — two spellings of one task",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives, re-aimed at the label: the notice and the card above it must spell the piece the
        # same way. Task #N numbering and taskCalled(lost.number) went with tasks, and
        # lostReplySentence now writes 'the reply to ${lost.label}' (W1.2). The killer asserts the
        # exact sentence and that the notice and card share a heading, so the plant spells the piece
        # with a stray '#'. Killed by `the-three-sentences-beside-the-cards.test.ts`.
        [
            (LOST_REPLY, '`the reply to ${lost.label}`', '`the reply to #${lost.label}`'),
        ],
    ),
    (
        "M9 · 🔴 **G5 · the fold removed** · an unnamed agent launched as `Dev` reads *\"dev to Dev\"* "
        "on one card, and *Dev* above its own replies",
        [
            (
                PANE,
                "  return agentName(oneSpelling(meta.profileId), props.identities ?? null)\n",
                "  return agentName(meta.profileId, props.identities ?? null)\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **G5 · the reply heading derived a second time** · the cards fold and the "
        "agent's own replies do not — one agent, two spellings, one pane",
        [
            (
                PANE,
                "const who = computed(() => ownAgent.value ?? 'Assistant')\n",
                "const who = computed(() =>\n  props.record.meta\n"
                "    ? agentName(props.record.meta.profileId, props.identities ?? null)\n"
                "    : 'Assistant',\n)\n",
            )
        ],
    ),
    (
        "M11 · 🔴 **G4 · the heading word handed to a relay as a name** · a recording's card reads "
        "*\"Ada to claude\"* again",
        [
            (
                VIEW,
                "          v-else-if=\"row.item.kind === 'relayed'\"\n          :item=\"row.item\"\n"
                "          :identities=\"props.identities ?? null\"\n"
                "          :own-agent=\"props.ownAgent ?? null\"\n",
                "          v-else-if=\"row.item.kind === 'relayed'\"\n          :item=\"row.item\"\n"
                "          :identities=\"props.identities ?? null\"\n"
                "          :own-agent=\"props.ownAgent ?? props.who\"\n",
            )
        ],
    ),
    (
        "M12 · ⚑ **G4 · the same, on an outgoing call** · *\"claude to Ada\"*, and *\"sub-agent to "
        "Ada\"* in a child's work",
        [
            (
                VIEW,
                "          :words=\"row.item.outgoing\"\n          :session-id=\"props.sessionId\"\n          :own-agent=\"props.ownAgent ?? null\"\n",
                "          :words=\"row.item.outgoing\"\n          :session-id=\"props.sessionId\"\n          :own-agent=\"props.ownAgent ?? props.who\"\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **the live pane hands no name** · every card in a conversation the person is watching "
        "says *this conversation* where it said *BroBot*",
        [
            (
                PANE,
                "          :own-agent=\"ownAgent\"\n",
                "",
            )
        ],
    ),
    (
        "M14 · ⚠️ **a recording handed no roster, at the pane** · the other agent reads as its slug, "
        "*ada*, on every card",
        [
            (
                READING,
                # ⚑ **678 re-anchored and the ROW is unchanged** — the pane binds its own agent's name
                # beside the roster now (`671` G4a), and the row still takes the roster away.
                "      :own-agent=\"ownAgent\"\n      :identities=\"props.identities ?? null\"\n",
                "      :own-agent=\"ownAgent\"\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **a recording handed no roster, at the screen** · the pane asks for one and the "
        "screen never passes it",
        [
            (
                SCREEN,
                "            :entry=\"reading.entry\"\n            :identities=\"agentStore.identities.value?.identities ?? null\"\n",
                "            :entry=\"reading.entry\"\n",
            )
        ],
    ),
    (
        "M16 · ⚑ **G4 · the heading word handed to a work report** · a recording's reply reads "
        "*\"Ada to claude\"* on its from-line",
        [
            (
                VIEW,
                "          :held=\"heldIds\"\n          :identities=\"props.identities ?? null\"\n"
                "          :own-agent=\"props.ownAgent ?? null\"\n",
                "          :held=\"heldIds\"\n          :identities=\"props.identities ?? null\"\n"
                "          :own-agent=\"props.ownAgent ?? props.who\"\n",
            )
        ],
    ),
    (
        "M17 · ⚑ **G4 · the heading word handed to a held row** · a held relay and a held reply both "
        "read *\"Ada to claude\"*",
        [
            (
                VIEW,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d96cd5232 inserted limit props before queued ownership; preserve them while changing only the held row fallback to a provider.
                "          :identities=\"props.identities ?? null\"\n          :own-agent=\"props.ownAgent ?? null\"\n          :may-carry-on=\"mayCarryOn.has(row.item.id)\"",
                "          :identities=\"props.identities ?? null\"\n          :own-agent=\"props.ownAgent ?? props.who\"\n          :may-carry-on=\"mayCarryOn.has(row.item.id)\"",
            )
        ],
    ),
    (
        "M18 · 🔴 **G5 · the drawer's plate in the directory spelling** · *Project-Manager* on the "
        "plate, *project-manager* on the replies of the pane that mounts it",
        [
            (
                DRAWER,
                "agentName(oneSpelling(props.session.profileId), props.identities)",
                "agentName(props.session.profileId, props.identities)",
            )
        ],
    ),
    (
        "M19 · 🔴 **G5 · the rail's row in the directory spelling** · the conversation list names the "
        "agent one way and the pane it opens another",
        [
            (
                RAIL,
                "  return agentName(oneSpelling(meta.profileId), props.agents?.identities ?? null)\n",
                "  return agentName(meta.profileId, props.agents?.identities ?? null)\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ **G5 · a closed thread in the directory spelling** · the same agent, a third way, "
        "one list below the open rows",
        [
            (
                CLOSED,
                "      label: agentName(oneSpelling(row.profileId), input.identities ?? null),\n",
                "      label: agentName(row.profileId, input.identities ?? null),\n",
            )
        ],
    ),
    (
        "M21 · ⚠️ **a held relay's recipient falls back to a provider** · the second of the two places "
        "`QueuedMessage` names this side, where one `toMatch` used to be satisfied by the first",
        [
            (
                QUEUED,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 89ee4f806 moved held recipient words to the exchange heading; preserve its sender while changing only the recipient fallback.
                "            from: sender,\n            to: props.ownAgent ?? THIS_CONVERSATION,",
                "            from: sender,\n            to: props.ownAgent ?? 'claude',",
            )
        ],
    ),
    (
        "M22 · ⛔ **a record with no profile crashes the rail** · the fold assumes a string, and a "
        "record read back without one takes the whole conversation list down — `667`'s own first cut",
        [
            (
                SPELLING,
                "  return typeof profileId === 'string' ? foldProfileName(profileId) : profileId\n",
                "  return profileId === null ? null : foldProfileName(profileId)\n",
            )
        ],
    ),
]
