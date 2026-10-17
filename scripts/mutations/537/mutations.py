"""537 · Two rows in one transcript that say the wrong thing about themselves.

⛔ **Both were photographed in one window, in one minute** (`537-assets/not-sent-and-claude-13-29.png`),
while the tier ran for real:

| the row | what it said | what was true |
|---|---|---|
| a held message from another conversation | `not sent · waiting for the turn to end` | the WORK had already arrived — `list_tasks` was answering with it |
| every assistant turn | `claude` | the conversation is `project-manager`, which the rail, the `PROFILE` field and the AGENTS list all said |

## 🔴 A · the half of this table that is about NOT SAYING SOMETHING FALSE

⚠️ **`queueMessage` has two branches and they deliver two different things at two different
moments.** An idle target takes the WORDS straight out; a busy one gets `message_queued`, and
either way `recordAssignment` writes `task_assigned` in the same synchronous stretch. ⛔ **So the
work is handed over at QUEUE time** — number, id, `waiting`, and the instruction's own first line,
all of it in `list_tasks` — **and the words at the next turn boundary.**

⚑ **The transcript drew only the second fact**, because `task_assigned`'s fold arm draws nothing on
a stated reason: *"the message bubble above it already says the work arrived."* ⛔ **True of the
idle branch and false of the held one**, where that bubble says the opposite —
`a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`.

🔴 **Half of these rows therefore guard the OTHER direction**: a row that announced work on a
message that carried none, or on one that has already ended, would be this defect inverted and
would read as a better sentence rather than as a lie.

## 🔴 B · one naming function, and the surfaces that were not asking it

⛔ **`agentName` has been the app's one naming function since `449`**, when the rail stopped titling
every conversation `brobot-workspace`. ⚠️ **Two components kept their own answer** — the pane, whose
`who` fed the turn author, the composer's placeholder and its footer, and the drawer, whose plate
read `session.provider`. ⚑ **Neither was a fourth derivation waiting to be written; both were one
that already existed and was not being asked**, which is `169` §1's *the validation must be ONE
rule, not two*.

## ⛔ What this table does NOT cover

 1. **Whether a held message gets an ENDING at all.** `354` and `379` closed that, and
    `queued-message.test.ts` owns the host half; nothing here edits `runtime-host.ts`.
 2. **The two launcher doors.** `NewConversation` says `BroBot` and `StartAsAgent` says a SLUG,
    both before there is a conversation or a roster — `537` findings, reported and not repaired,
    so no row pins bytes this dispatch did not write.
 3. **The panel's contents.** `535` is drawing it; `537` §5 leaves only the WORD in scope.
"""

FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
ROW = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
DRAWER = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"

MUTATIONS = [
    # ---- A · the work arrived, and the row has to be able to see it -------------------------------
    (
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the fold stops joining the assignment to the held "
        "row, so a message whose work is already on the agent's task list goes on saying `not "
        "sent`. ⛔ This is the photograph exactly: the row above, and the agent naming the task it "
        "had just been given below",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece model: when `work_given` names the held message (`messageId`), the
        # fold must join the piece's label to that held row so the row stops saying 'not sent' about
        # words whose work has already arrived. The join is now `held.label = event.label` in the
        # `work_given` arm, and the killer was rewritten to plant W1.12 and expect 'on its list as
        # W1.12 ...'. Killed by `two-rows-that-say-the-wrong-thing.render.test.ts`.
        [
            (FOLD, '      if (event.messageId !== undefined) {\n        const held = heldMessageNamed(state, event.messageId)\n        if (held) held.label = event.label\n      }\n', ''),
        ],
    ),
    (
        "M2 · ⛔ the join answers by POSITION again · `openQueuedItem`'s unnamed fallback is for a "
        "ledger written before `354`, and an assignment always carries its id — so reaching for it "
        "here puts one message's task number onto another message's words, which is `413`'s defect "
        "one event over",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The work_given arm of the fold still joins the held row by the
        # message's own name (heldMessageNamed); D-022 added a work_rebriefed arm with the same
        # one-liner, so the bare anchor now matches twice. The anchor is extended over the next line
        # (held.label = event.label), which only work_given has, and the plant puts back the
        # positional openQueuedItem fallback. Killed by
        # `two-rows-that-say-the-wrong-thing.render.test.ts`.
        [
            (FOLD, '        const held = heldMessageNamed(state, event.messageId)\n        if (held) held.label = event.label\n', '        const held = openQueuedItem(state, event.messageId)\n        if (held) held.label = event.label\n'),
        ],
    ),
    (
        "M3 · ⚠️ the row stops leading with the WORK · the sentence is still computed and the "
        "template never reaches it, so the surface falls back to `not sent` about an instruction "
        "the agent can read. ⛔ A guard that silently never fires is the defect wearing the repair",
        [
            (
                ROW,
                '<template v-if="arrived !== null"',
                '<template v-if="false"',
            )
        ],
    ),
    (
        "M4 · 🔴 the row forgets that an ENDING replaces this sentence · a cancelled or abandoned "
        "message announces work that is on somebody's list when the words were never sent. ⛔ The "
        "inverted defect, and it reads as a more helpful row rather than as a false one",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # inverted-defect guard survives: `arrived` shows the label only while the row is still held
        # (`outcome === null`), because a cancelled, abandoned or retracted message must read 'not
        # sent · ...' even though it carries a label. Dropping the outcome guard in
        # QueuedMessage.vue makes those rows announce work on the agent's list about words that were
        # never sent. Killed by `two-rows-that-say-the-wrong-thing.render.test.ts`.
        [
            (ROW, 'const arrived = computed(() => (props.item.outcome === null ? (props.item.label ?? null) : null))', 'const arrived = computed(() => props.item.label ?? null)'),
        ],
    ),
    (
        "M5 · ⚠️ the number goes out of the sentence · *on its task list* with nothing a person can "
        "quote is a claim they cannot check, and the number is the one thing in this ledger that "
        "turns a `task_<uuid4>` into a word (`474`)",
                # ⚠️ **672 · re-anchored** — the number is spelled `Task #N` now (`taskCalled`), and the
                # template wraps; dropping it is the same defect.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — D-017 added an
        # `untilItStarts` ternary right after the sentence (a held message can now say 'it starts'
        # as well as 'the turn ends'), so the old two-line text no longer matches, but the rule —
        # the task number must stay in the sentence — is unchanged and still checked by exact-string
        # render tests.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that the task
        # number stays in the sentence *on its task list as Task #N* survives. D-017b only renamed
        # the `untilItStarts` ternary to `withTheNextMessage` and reworded its two arms (`'with the
        # next message' : 'when the turn ends'`). The plant drops `as {{ taskCalled(arrived) }}`
        # from the current template text.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the held row must quote the piece label a person can check ('on its list as
        # W1.12'), not a bare 'on its list'. The task number is gone, but `QueuedItem.label`
        # replaced it, and the template arm is now `on its list as {{ arrived }}`; dropping the
        # label out of the sentence leaves the unverifiable claim the row guarded. Killed by
        # `two-rows-that-say-the-wrong-thing.render.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 155331d5a inserted held-provider wording below this prefix; omit only the task-list handle.
            (ROW, "              on its list as {{ arrived }} · these words\n", "              on its list · these words\n"),
        ],
    ),
    # ---- B · who is speaking ----------------------------------------------------------------------
    (
        "M6 · 🔴 THE SECOND SHIPPED DEFECT, PUT BACK · the pane names the speaker by its PROVIDER, "
        "so every turn, the composer's placeholder and its footer say `claude` about a "
        "conversation every other surface calls `project-manager`",
                # ⚑ **667 re-anchored and the ROW is unchanged** — the pane asks in `oneSpelling`
                # now (`658`'s G5); the defect put back is the same one.
                # ⚑ **678 re-anchored and the ROW is unchanged** — `agentName` folds its own fallback since
                # `671`, so the renderer's `oneSpelling` is gone and the pane asks `agentName` directly.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that the pane
        # names the speaker by its identity, never by the provider, survives. The pane's `ownAgent`
        # now returns `whoIsIn(meta, props.identities ?? null)` and `agentName` is no longer
        # imported there, so the plant is `return meta.provider` (no new identifier, no
        # ReferenceError). The provider name is still the right answer only for a ranAsNobody
        # conversation, which `whoIsIn` handles.
        [
            (PANE, 'return whoIsIn(meta, props.identities ?? null)', 'return meta.provider'),
        ],
    ),
    (
        "M7 · ⛔ the un-answered record INVENTS an identity · a window has made it and the host has "
        "not replied, and naming it BroBot on the strength of that null is what `profileLabel`'s "
        "own note forbids one null from doing",
        [
            (
                PANE,
                # ⚑ **667 re-anchored and the ROW is unchanged** — the word for the absence moved
                # onto `who`, which is `ownAgent ?? 'Assistant'` now that the cards are handed the
                # absence itself; naming it BroBot is the same invention.
                "const who = computed(() => ownAgent.value ?? 'Assistant')",
                "const who = computed(() => ownAgent.value ?? 'BroBot')",
            )
        ],
    ),
    (
        "M8 · ⚠️ a SECOND answer to *what is this identity called* · `displayName ?? slug` spelled "
        "out again agrees with `agentName` today and drifts the first time either moves — which is "
        "the pair `449` was written to end",
                # ⚑ **667 re-anchored and the ROW is unchanged** — the pane asks in `oneSpelling`
                # now (`658`'s G5); the defect put back is the same one.
                # ⚑ **678 re-anchored and the ROW is unchanged** — `agentName` folds its own fallback since
                # `671`, so the renderer's `oneSpelling` is gone and the pane asks `agentName` directly.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that only the
        # one naming function may answer *what is this identity called*, with no second `displayName
        # ?? slug`, survives; the owner is now `whoIsIn` in session-record.ts, which delegates to
        # `agentName`. The plant spells the fallback out in the pane, using only `props.identities`
        # and `meta`, so nothing new is referenced.
        [
            (PANE, 'return whoIsIn(meta, props.identities ?? null)', 'return (\n    props.identities?.find((one) => one.slug === meta.profileId)?.displayName ??\n    meta.profileId\n  )'),
        ],
    ),
    (
        "M9 · ⛔ the plate at the top of the Open tab goes back to the provider · the drawer is "
        "what HANDS `SessionBot` a name, and a prop census would pass over this without noticing "
        "that the giver changed what it gives",
                # ⚑ **667 re-anchored and the ROW is unchanged** — the drawer asks in `oneSpelling`
                # now, beside the pane that mounts it (`658`'s G5, found by `667`'s review).
                # ⚑ **678 re-anchored and the ROW is unchanged** — `agentName` folds its own fallback since
                # `671`, so the renderer's `oneSpelling` is gone and the drawer asks `agentName` directly.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that the
        # drawer's plate is named by the identity survives. `SessionDrawer.vue` line 270 is now
        # `const who = computed(() => whoIsIn(props.session, props.identities))`, and the drawer
        # also passes `:profile="profileItRunsAs(props.session)"`. The plant puts the provider back.
        [
            (DRAWER, 'const who = computed(() => whoIsIn(props.session, props.identities))', 'const who = computed(() => props.session.provider)'),
        ],
    ),
]
